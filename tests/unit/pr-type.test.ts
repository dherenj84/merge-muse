import {
  findMatchingLabel,
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

describe("findMatchingLabel", () => {
  it("matches a standard GitHub alias case-insensitively", () => {
    expect(
      findMatchingLabel("feat", ["Bug", "Enhancement", "help wanted"]),
    ).toBe("Enhancement");
    expect(findMatchingLabel("fix", ["bug", "documentation"])).toBe("bug");
  });

  it("matches a type:<kind> label from a previous run", () => {
    expect(findMatchingLabel("refactor", ["type:refactor", "bug"])).toBe(
      "type:refactor",
    );
  });

  it("returns null when no alias matches", () => {
    expect(
      findMatchingLabel("ci", ["bug", "enhancement", "documentation"]),
    ).toBeNull();
  });

  it("preserves original label casing in the return value", () => {
    expect(findMatchingLabel("docs", ["Documentation"])).toBe("Documentation");
  });
});
