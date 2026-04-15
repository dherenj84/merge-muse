import { normalizeDiff } from "../../src/pipeline/diff-normalizer";
import {
  sourceFile,
  testFile,
  lockFile,
  binaryFile,
  configFile,
} from "../fixtures/changed-files";

describe("normalizeDiff", () => {
  it("filters binary files", () => {
    const result = normalizeDiff([binaryFile]);
    expect(result.files).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("filters noise files (lockfiles)", () => {
    const result = normalizeDiff([lockFile]);
    expect(result.files).toHaveLength(0);
    expect(result.skippedCount).toBe(1);
  });

  it("keeps source and test files", () => {
    const result = normalizeDiff([sourceFile, testFile]);
    expect(result.files).toHaveLength(2);
    expect(result.skippedCount).toBe(0);
  });

  it("correctly categorizes files", () => {
    const result = normalizeDiff([sourceFile, testFile, configFile]);
    expect(result.fileCategories).toContain("source");
    expect(result.fileCategories).toContain("test");
    expect(result.fileCategories).toContain("infra");
  });

  it("sums additions and deletions correctly", () => {
    const result = normalizeDiff([sourceFile, testFile]);
    expect(result.totalAdditions).toBe(
      sourceFile.additions + testFile.additions,
    );
    expect(result.totalDeletions).toBe(
      sourceFile.deletions + testFile.deletions,
    );
  });

  it("filters both binary and noise in a mixed list", () => {
    const result = normalizeDiff([sourceFile, binaryFile, lockFile, testFile]);
    expect(result.files).toHaveLength(2);
    expect(result.skippedCount).toBe(2);
  });
});
