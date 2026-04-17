import {
  Body,
  Controller,
  Example,
  Header,
  Post,
  Response,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from "tsoa";

/** Webhook accepted response payload. */
interface AcceptedResponse {
  /** Indicates the webhook was accepted for async processing.
   * @example true
   */
  accepted: true;
}

/** Webhook skipped response payload. */
interface SkippedResponse {
  /** Indicates this delivery was intentionally skipped.
   * @example true
   */
  skipped: true;
  /** Human-readable skip reason.
   * @example "duplicate delivery"
   * @pattern ^[\x20-\x7E]{1,256}$
   * @maxLength 256
   */
  reason: string;
}

/** Error response payload. */
interface ErrorResponse {
  /** Error message.
   * @example "Invalid signature"
   * @pattern ^[\x20-\x7E]{1,512}$
   * @minLength 1
   * @maxLength 512
   */
  error: string;
}

/** Supported GitHub webhook event header values for this endpoint. */
type GithubEventType = "pull_request";

/** Supported GitHub pull_request action values. */
type GithubPullRequestAction =
  | "assigned"
  | "unassigned"
  | "labeled"
  | "unlabeled"
  | "opened"
  | "edited"
  | "closed"
  | "reopened"
  | "synchronize"
  | "ready_for_review"
  | "locked"
  | "unlocked"
  | "review_requested"
  | "review_request_removed"
  | "converted_to_draft"
  | "auto_merge_enabled"
  | "auto_merge_disabled";

interface GithubInstallation {
  /** GitHub App installation identifier.
   * @example 123456789
   * @minimum 1
   * @maximum 9999999999
   */
  id: number;
}

interface GithubPullRequestRef {
  /** Branch name.
   * @example "main"
   * @pattern ^[A-Za-z0-9._/\-]{1,255}$
   * @minLength 1
   * @maxLength 255
   */
  ref: string;
  /** Commit SHA of the branch reference.
   * @example "abc123def456"
   * @pattern ^[A-Fa-f0-9]{7,64}$
   */
  sha: string;
}

interface GithubPullRequestHead {
  /** Head commit SHA.
   * @example "ff0011aa22bb"
   * @pattern ^[A-Fa-f0-9]{7,64}$
   */
  sha: string;
}

interface GithubPullRequest {
  /** Pull request number.
   * @example 42
   * @minimum 1
   * @maximum 2147483647
   */
  number: number;
  /** Whether the PR is merged.
   * @example true
   */
  merged: boolean;
  /** Pull request title.
   * @example "fix: handle webhook retry failures"
   * @pattern ^[^\x00-\x08\x0E-\x1F\x7F]{1,256}$
   * @minLength 1
   * @maxLength 256
   */
  title: string;
  /** Pull request body/description.
   * @example "## Summary\n- add bounded retries"
   * @pattern ^[^\x00-\x08\x0E-\x1F\x7F]{0,65535}$
   * @maxLength 65535
   */
  body: string | null;
  /** Base branch reference. */
  base: GithubPullRequestRef;
  /** Head branch reference. */
  head: GithubPullRequestHead;
  /** Merge commit SHA if merged.
   * @example "d34db33f"
   * @pattern ^[A-Fa-f0-9]{7,64}$
   */
  merge_commit_sha: string | null;
  /** Browser URL for the pull request.
   * @example "https://github.com/acme/repo/pull/42"
   * @pattern ^https?://[^\s]{1,2046}$
   * @format uri
   * @maxLength 2048
   */
  html_url: string;
}

interface GithubRepositoryOwner {
  /** Repository owner login.
   * @example "acme-org"
   * @pattern ^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$
   */
  login: string;
}

interface GithubRepository {
  /** Repository name.
   * @example "merge-muse"
   * @pattern ^[A-Za-z0-9._-]{1,100}$
   * @minLength 1
   * @maxLength 100
   */
  name: string;
  /** Full repository name.
   * @example "acme-org/merge-muse"
   * @pattern ^[^/\s]+/[^/\s]+$
   * @minLength 3
   * @maxLength 200
   */
  full_name: string;
  /** Repository owner object. */
  owner: GithubRepositoryOwner;
  /** Default branch name.
   * @example "main"
   * @pattern ^[A-Za-z0-9._/\-]{1,255}$
   * @minLength 1
   * @maxLength 255
   */
  default_branch: string;
}

/** Subset of GitHub pull_request webhook payload used by MergeMuse. */
interface GithubPullRequestEventPayload {
  /** Webhook action.
   * @example "closed"
   */
  action: GithubPullRequestAction;
  /** Pull request number from payload root.
   * @example 42
   * @minimum 1
   * @maximum 2147483647
   */
  number: number;
  /** Installation context for this webhook delivery. */
  installation: GithubInstallation;
  /** Pull request payload. */
  pull_request: GithubPullRequest;
  /** Repository payload. */
  repository: GithubRepository;
}

@Route("")
@Tags("Webhook")
export class WebhookController extends Controller {
  /**
   * Receives GitHub pull_request webhook deliveries for async processing.
   */
  @Post("webhook")
  @Security("ApiKeyAuth")
  @SuccessResponse("202", "Accepted for async processing")
  @Response<SkippedResponse>("200", "Skipped event")
  @Response<ErrorResponse>("400", "Invalid request")
  @Response<ErrorResponse>("401", "Invalid signature")
  @Response<ErrorResponse>("403", "Forbidden")
  @Response<ErrorResponse>("406", "Not acceptable")
  @Response<ErrorResponse>("415", "Unsupported media type")
  @Response<ErrorResponse>("429", "Too many requests")
  @Response<ErrorResponse>("default", "Unexpected error")
  @Example<AcceptedResponse>({ accepted: true })
  public receiveWebhook(
    /**
     * HMAC signature generated by GitHub using the configured webhook secret.
     * @example "sha256=0f0e0d..."
     * @pattern ^sha256=[a-f0-9]{64}$
     * @maxLength 71
     */
    @Header("x-hub-signature-256") _signature: string,
    /**
     * GitHub webhook event type.
     * @example "pull_request"
     */
    @Header("x-github-event") _eventType: GithubEventType,
    /**
     * GitHub pull_request webhook payload.
     */
    @Body() _payload: GithubPullRequestEventPayload,
    /**
     * Unique GitHub webhook delivery identifier.
     * @example "9f3b9ea0-1111-2222-3333-444455556666"
     * @pattern ^[0-9a-fA-F-]{36,128}$
     * @maxLength 128
     */
    @Header("x-github-delivery") _deliveryId?: string,
  ): AcceptedResponse {
    // Documentation-only controller used by tsoa spec generation.
    return { accepted: true };
  }
}
