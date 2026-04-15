import {
  inferPrTypeFromTitle,
  typeLabelForPrType,
} from "../../src/pipeline/pr-type";

describe("inferPrTypeFromTitle", () => {
  it("parses conventional commit type from title", () => {
    expect(inferPrTypeFromTitle("feat: add webhook retries")).toBe("feat");
    expect(inferPrTypeFromTitle("fix(api): handle 404 config")).toBe("fix");
    expect(inferPrTypeFromTitle("DOCS: update setup")).toBe("docs");
  });

  it("returns null when no conventional type is present", () => {
    expect(inferPrTypeFromTitle("Update README and tests")).toBeNull();
  });
});

describe("typeLabelForPrType", () => {
  it("creates a deterministic type label", () => {
    expect(typeLabelForPrType("feat")).toBe("type:feat");
    expect(typeLabelForPrType("chore")).toBe("type:chore");
  });
});
