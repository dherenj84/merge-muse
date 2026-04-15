# MergeMuse Copilot Instructions

## Product Intent

MergeMuse is a self-hosted GitHub App that listens for merged pull requests and rewrites the PR title and body so they better reflect the actual merged code changes.

The app is intentionally:

- self-hosted
- stateless
- enterprise-friendly
- OpenAI-compatible rather than vendor-locked
- repository-configurable through `.mergemuse.yml`

Do not drift the project toward a hosted SaaS architecture unless explicitly requested.

## Core Behavior

The expected pipeline is:

1. Receive a GitHub `pull_request` webhook.
2. Verify the `X-Hub-Signature-256` signature.
3. Ignore events that are not merged PR closures.
4. Deduplicate repeated deliveries in memory.
5. Fetch PR metadata, changed files, and optional `.mergemuse.yml`.
6. Normalize the diff into an LLM-friendly representation.
7. Call an OpenAI-compatible chat completion endpoint.
8. Validate the generated rewrite.
9. Apply the result in `patch`, `comment`, or `dry-run` mode.
10. Emit structured audit logs to stdout.

When changing this flow, preserve fast webhook acknowledgement and async processing.

## Non-Negotiable Constraints

- No database by default.
- No background queue or distributed worker requirement unless explicitly requested.
- No hidden vendor dependency on a specific LLM provider.
- No assumption of GitHub.com only. Preserve GitHub Enterprise Server support via `GITHUB_API_URL`.
- Keep configuration env-driven with optional repo overrides from `.mergemuse.yml`.
- Keep the app safe by default: signature verification, bounded in-memory dedup, validated model output, and deterministic fallback behavior.

## Configuration Model

Runtime configuration comes from environment variables.

Repository-specific overrides come from `.mergemuse.yml` in the target repository root.

Current repo-level settings are:

- `enabled`
- `base_branch`
- `action_mode`

If new configuration is introduced:

- add it to `.env.example` when it is runtime-level
- document it in `README.md`
- keep defaults explicit and conservative
- avoid adding configuration that requires persistent storage unless necessary

## Implementation Preferences

- Target Node.js 24+.
- Keep Docker images and local tooling aligned with Node 24.
- Prefer straightforward TypeScript and small modules.
- Keep the pipeline deterministic where possible.
- Use structured JSON logs for operational events.
- Favor minimal dependencies unless there is a clear operational win.

## LLM-Specific Guidance

- Treat model output as untrusted input.
- Preserve the validation layer and deterministic fallback path.
- Do not assume the model will always return valid JSON even if prompted to do so.
- Keep prompts grounded in the actual diff and PR metadata.
- Avoid inventing intent or rationale that cannot be inferred from the code changes.

## Safety And Scope

- Only process merged pull requests.
- Do not widen mutation scope beyond the PR title/body or PR comments unless explicitly requested.
- Avoid features that would write to unrelated issues, branches, or repositories by default.
- Preserve the current secret-leakage checks around generated content.

## Testing Expectations

When making behavioral changes:

- update or add unit tests under `tests/`
- keep `npm test` and `npm run build` passing on Node 24
- prefer testing normalization, validation, and config parsing logic directly

## Documentation Expectations

If behavior, configuration, setup, or deployment changes, update `README.md` and `.env.example` in the same change.

## Avoid These Mistakes

- Do not reintroduce a database for basic auditing or dedup.
- Do not turn webhook handling into a long synchronous request path.
- Do not hardcode a single LLM provider's API quirks unless behind a generic abstraction.
- Do not bypass rewrite validation before applying changes to a PR.
- Do not make repo settings mandatory; env defaults must continue to work without `.mergemuse.yml`.
