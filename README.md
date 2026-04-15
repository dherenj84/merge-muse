# MergeMuse

MergeMuse is a self-hosted GitHub App that reviews merged pull requests and rewrites the PR title and body so they better match the actual code changes.

It is designed for teams that want an AI powered and accurate PR metadata after merge without introducing a database or a hosted control plane.

## What It Does

When GitHub sends a `pull_request` webhook for a merged PR, MergeMuse:

1. Verifies the webhook signature.
2. Ignores non-merged PR events.
3. Deduplicates repeated webhook deliveries in memory.
4. Fetches the merged PR metadata and changed files.
5. Loads optional repo-level settings from `.mergemuse.yml`.
6. Normalizes the diff into an LLM-friendly summary.
7. Calls an OpenAI-compatible chat completion endpoint.
8. Validates the generated title and body.
9. Applies the rewrite by patching the PR, posting a comment, or logging a dry run.
10. If assignees are missing, assigns the PR author; if labels are missing, adds a `type:*` label inferred from PR type.
11. Emits structured audit logs to stdout.

## Design Goals

- Self-hosted and enterprise-friendly
- Stateless runtime with no database
- OpenAI-compatible endpoint support rather than vendor lock-in
- Simple per-repo control via `.mergemuse.yml`
- Safe fallback behavior when the model output is invalid or unavailable

## Runtime

- Node.js 24+
- Docker optional
- No database required

Local development uses [.nvmrc](.nvmrc) and the container images in [Dockerfile](Dockerfile) also target Node 24.

## HTTP Endpoints

- `POST /webhook`: GitHub App webhook receiver
- `GET /health`: basic health check

## GitHub App Requirements

MergeMuse is intended to run as a GitHub App.

Recommended minimum permissions:

- `Pull requests: Read and write`
- `Contents: Read`
- `Metadata: Read`

Required webhook subscription:

- `Pull request`

Why these are needed:

- MergeMuse reads PR metadata and changed files.
- It reads `.mergemuse.yml` from the repository root.
- It updates the PR title/body or posts a PR comment depending on mode.

## Configuration

All runtime configuration is supplied through environment variables. Start with [.env.example](.env.example).

Required variables:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_API_KEY`

Important optional variables:

- `DEFAULT_BASE_BRANCH` default: `main`
- `DEFAULT_ACTION_MODE` default: `patch`
- `PORT` default: `3000`
- `HOST` default: `0.0.0.0`
- `DEDUP_CACHE_MAX` default: `1000`
- `DEDUP_CACHE_TTL_MS` default: `3600000`
- `DIFF_MAX_FILE_BYTES` default: `50000`
- `DIFF_MAX_FILES` default: `100`
- `GITHUB_API_URL` for GitHub Enterprise Server
- `LOCAL_MOCK_MODE` default: disabled (`true` enables local synthetic GitHub data path)

### Private Key Formats

`GITHUB_PRIVATE_KEY` supports two formats:

1. Inline PEM content with escaped newlines
2. `@/path/to/key.pem` to load the key from a file

## Repo-Level Settings

Each repository can override defaults with a `.mergemuse.yml` file at the repo root.

There is a ready-to-copy example in [.mergemuse.example.yml](.mergemuse.example.yml).

Example:

```yaml
enabled: true
base_branch: main
action_mode: patch
```

Supported fields:

- `enabled`: `true` or `false`
- `base_branch`: branch name to watch for merged PRs
- `action_mode`: `patch`, `comment`, or `dry-run`

Mode behavior:

- `patch`: update the PR title and body in place
- `comment`: post a suggested rewrite as a PR comment
- `dry-run`: generate and log the result without mutating the PR

## LLM Compatibility

MergeMuse uses an OpenAI-compatible `POST /v1/chat/completions` interface.

That means it can be pointed at providers such as:

- OpenAI
- Azure OpenAI compatible endpoints
- Ollama
- vLLM
- LM Studio
- other OpenAI-compatible gateways

The service expects the configured endpoint to accept chat-completion requests and return standard completion content.

## Local Development

### 1. Use Node 24

```bash
nvm use 24
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your env file

```bash
cp .env.example .env
```

Fill in the required GitHub App and LLM values.

### 4. Run the app

```bash
npm run dev
```

The service will listen on the configured host and port, with the webhook endpoint at `/webhook`.

### Local Full-Pipeline Testing Without GitHub App Installation

For local webhook-to-LLM testing without GitHub API access, set:

```env
LOCAL_MOCK_MODE=true
```

In this mode, merged webhook payloads still go through:

- diff normalization
- prompt construction
- LLM call
- validation/fallback
- audit logging

The apply stage is forced to `dry-run` and no GitHub API write is performed.

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

The Compose file expects a local `.env` file and exposes port `3000` by default.

## GCP Deployment (Cloud Build + Cloud Run)

For a stable public webhook URL, deploy MergeMuse on Cloud Run and use Cloud Build to build from GitHub.

### 1. Create Artifact Registry repository

```bash
gcloud artifacts repositories create mergemuse \
  --repository-format=docker \
  --location=us-central1
```

### 2. Create/update runtime secrets

Store sensitive values in Secret Manager (recommended):

- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `LLM_API_KEY`

Non-secret env vars such as `GITHUB_APP_ID`, `LLM_BASE_URL`, and `LLM_MODEL` can be set directly on the Cloud Run service.

### 3. Add required env vars to Cloud Run

At minimum, ensure the service has:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_API_KEY`

Cloud Run injects `PORT` automatically; MergeMuse will bind to it.

### 4. Build and deploy with Cloud Build

This repo includes [cloudbuild.yaml](cloudbuild.yaml).

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_AR_REPO=mergemuse,_SERVICE=merge-muse,_DEPLOY=true,_GITHUB_APP_ID=123456,_LLM_BASE_URL=https://api.openai.com,_LLM_MODEL=gpt-4o-mini,_GITHUB_PRIVATE_KEY_SECRET=GITHUB_PRIVATE_KEY,_GITHUB_WEBHOOK_SECRET_SECRET=GITHUB_WEBHOOK_SECRET,_LLM_API_KEY_SECRET=LLM_API_KEY
```

If you only want to build and push (no deploy), set `_DEPLOY=false`.

Optional substitutions:

- `_DEFAULT_BASE_BRANCH` default: `main`
- `_DEFAULT_ACTION_MODE` default: `patch`
- `_GITHUB_API_URL` for GHES deployments

### 5. Configure GitHub App webhook URL

Use your Cloud Run HTTPS URL with `/webhook`, for example:

`https://merge-muse-xxxxx-uc.a.run.app/webhook`

Make sure the GitHub App webhook secret exactly matches `GITHUB_WEBHOOK_SECRET` configured in Cloud Run.

## Build And Test

Run the full validation flow:

```bash
npm test
npm run build
```

The repository also includes a Node 24 CI workflow in [.github/workflows/ci.yml](.github/workflows/ci.yml) that runs `npm ci`, `npm test`, and `npm run build` on pushes to `main` and on pull requests.

Current project status:

- Unit tests are present for diff normalization, rewrite validation, repo settings, and delivery deduplication.
- The service builds cleanly on Node 24.

## Operational Notes

- MergeMuse is stateless. Restarting the process clears the in-memory dedup cache.
- Audit events are written to stdout as JSON.
- The webhook handler acknowledges GitHub quickly and continues processing asynchronously.
- If the LLM call fails or returns invalid output, MergeMuse falls back to a deterministic summary.

## Repository Layout

```text
src/
  audit/      structured audit logging
  config/     env and repo settings
  github/     GitHub App auth client
  http/       webhook entrypoint and dedup cache
  llm/        OpenAI-compatible client
  pipeline/   PR fetch, diff normalization, prompt, validation, apply
tests/        fixtures and unit tests
```

## Security Notes

- Webhook signatures are verified with `X-Hub-Signature-256`.
- Only merged `pull_request` events are processed.
- Model output is validated before being applied.
- Basic secret-pattern detection prevents obvious credential leakage into generated PR text.

## Current Limitations

- Deduplication is per-process rather than shared across replicas.
- There is no persistent audit store beyond container/process logs.
- The rewrite quality is only as good as the supplied diff and model.

## License

MIT
