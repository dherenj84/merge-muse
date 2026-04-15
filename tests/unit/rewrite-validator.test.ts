import { validateAndFallback } from "../../src/pipeline/rewrite-validator";
import type { LlmResponse } from "../../src/llm/openai-compatible-client";
import type { PrMetadata } from "../../src/pipeline/pr-fetch";
import type { NormalizedDiff } from "../../src/pipeline/diff-normalizer";

const metadata: PrMetadata = {
  number: 42,
  title: "Update stuff",
  body: "Various changes",
  authorLogin: "example-user",
  existingAssignees: [],
  existingLabels: [],
  repoLabels: [],
  headSha: "abc",
  baseSha: "def",
  mergeCommitSha: "ghi",
  htmlUrl: "https://github.com/example/repo/pull/42",
  additions: 30,
  deletions: 10,
  changedFiles: 2,
};

const diff: NormalizedDiff = {
  files: [
    {
      filename: "src/user.ts",
      status: "modified",
      additions: 30,
      deletions: 10,
      patch: "@@ -1 +1 @@\n-old\n+new",
    },
  ],
  skippedCount: 0,
  totalAdditions: 30,
  totalDeletions: 10,
  fileCategories: ["source"],
};

function makeLlmResponse(content: string): LlmResponse {
  return { content, inputTokens: 100, outputTokens: 50, model: "test-model" };
}

describe("validateAndFallback", () => {
  it("accepts valid LLM JSON", () => {
    const response = makeLlmResponse(
      JSON.stringify({
        title: "feat: improve user lookup",
        body: "Converted getUser to async.",
      }),
    );
    const result = validateAndFallback(response, metadata, diff);
    expect(result.usedLlm).toBe(true);
    expect(result.title).toBe("feat: improve user lookup");
    expect(result.body).toBe("Converted getUser to async.");
  });

  it("falls back when LLM returns invalid JSON", () => {
    const response = makeLlmResponse("not json at all");
    const result = validateAndFallback(response, metadata, diff);
    expect(result.usedLlm).toBe(false);
    expect(result.rejectionReason).toContain("not valid JSON");
  });

  it("falls back when title exceeds 72 chars", () => {
    const longTitle = "a".repeat(73);
    const response = makeLlmResponse(
      JSON.stringify({ title: longTitle, body: "Fine body." }),
    );
    const result = validateAndFallback(response, metadata, diff);
    expect(result.usedLlm).toBe(false);
    expect(result.rejectionReason).toContain("title validation failed");
  });

  it("uses fallback title but still returns when only body is rejected", () => {
    const longBody = "b".repeat(4001);
    const response = makeLlmResponse(
      JSON.stringify({ title: "feat: valid title", body: longBody }),
    );
    const result = validateAndFallback(response, metadata, diff);
    expect(result.usedLlm).toBe(false);
    expect(result.title).toBe("feat: valid title");
    expect(result.rejectionReason).toContain("body validation failed");
  });

  it("produces full fallback when llmResponse is null", () => {
    const result = validateAndFallback(null, metadata, diff);
    expect(result.usedLlm).toBe(false);
    expect(result.rejectionReason).toBe("LLM call failed");
    expect(result.title.length).toBeLessThanOrEqual(72);
  });

  it("strips markdown code fences from LLM output", () => {
    const response = makeLlmResponse(
      '```json\n{"title":"feat: nice title","body":"Some body."}\n```',
    );
    const result = validateAndFallback(response, metadata, diff);
    expect(result.usedLlm).toBe(true);
    expect(result.title).toBe("feat: nice title");
  });

  it("carries a valid LLM label that exists in repoLabels", () => {
    const metaWithLabels: PrMetadata = {
      ...metadata,
      repoLabels: ["bug", "enhancement", "documentation"],
    };
    const response = makeLlmResponse(
      JSON.stringify({
        title: "fix: resolve null pointer",
        body: "Fixed it.",
        label: "bug",
      }),
    );
    const result = validateAndFallback(response, metaWithLabels, diff);
    expect(result.usedLlm).toBe(true);
    expect(result.label).toBe("bug");
  });

  it("discards LLM label that is not in repoLabels", () => {
    const metaWithLabels: PrMetadata = {
      ...metadata,
      repoLabels: ["bug", "enhancement"],
    };
    const response = makeLlmResponse(
      JSON.stringify({
        title: "fix: resolve null pointer",
        body: "Fixed it.",
        label: "invented-label",
      }),
    );
    const result = validateAndFallback(response, metaWithLabels, diff);
    expect(result.usedLlm).toBe(true);
    expect(result.label).toBeUndefined();
  });

  it("matches LLM label case-insensitively and preserves repo casing", () => {
    const metaWithLabels: PrMetadata = {
      ...metadata,
      repoLabels: ["Enhancement"],
    };
    const response = makeLlmResponse(
      JSON.stringify({
        title: "feat: add dark mode",
        body: "Added it.",
        label: "enhancement",
      }),
    );
    const result = validateAndFallback(response, metaWithLabels, diff);
    expect(result.label).toBe("Enhancement");
  });
});
