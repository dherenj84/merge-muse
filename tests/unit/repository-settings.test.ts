import { parseRepoConfig } from "../../src/config/repository-settings";

describe("parseRepoConfig", () => {
  it("returns defaults when content is null", () => {
    const settings = parseRepoConfig(null);
    expect(settings.enabled).toBe(true);
    expect(settings.baseBranch).toBe("main");
    expect(settings.actionMode).toBe("patch");
  });

  it("returns defaults when YAML is empty", () => {
    const settings = parseRepoConfig("");
    expect(settings.enabled).toBe(true);
  });

  it("parses valid YAML", () => {
    const yaml = `enabled: false\nbase_branch: develop\naction_mode: comment`;
    const settings = parseRepoConfig(yaml);
    expect(settings.enabled).toBe(false);
    expect(settings.baseBranch).toBe("develop");
    expect(settings.actionMode).toBe("comment");
  });

  it("ignores invalid action_mode and falls back to default", () => {
    const yaml = `action_mode: invalid-value`;
    const settings = parseRepoConfig(yaml);
    expect(settings.actionMode).toBe("patch");
  });

  it("returns defaults on malformed YAML", () => {
    const settings = parseRepoConfig(":: bad :: yaml ::");
    expect(settings.enabled).toBe(true);
  });
});
