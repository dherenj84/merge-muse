import { fetchPrData } from "../../src/pipeline/pr-fetch";
import { Octokit } from "@octokit/rest";

function makeOctokit(overrides: {
  pullsGet?: () => Promise<unknown>;
  pullsListFiles?: () => Promise<unknown>;
  reposGetContent?: () => Promise<unknown>;
}): Octokit {
  return {
    pulls: {
      get:
        overrides.pullsGet ?? jest.fn().mockResolvedValue({ data: makePr() }),
      listFiles:
        overrides.pullsListFiles ?? jest.fn().mockResolvedValue({ data: [] }),
    },
    repos: {
      getContent:
        overrides.reposGetContent ??
        jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 }),
          ),
    },
  } as unknown as Octokit;
}

function makePr() {
  return {
    number: 1,
    title: "chore: test",
    body: "body",
    user: { login: "alice" },
    assignees: [],
    labels: [],
    head: { sha: "abc" },
    base: { sha: "def", ref: "main" },
    merge_commit_sha: "ghi",
    html_url: "https://github.com/owner/repo/pull/1",
    additions: 1,
    deletions: 0,
    changed_files: 1,
  };
}

describe("fetchPrData / fetchRepoConfig", () => {
  it("returns null repoConfigContent when .mergemuse.yml does not exist (404)", async () => {
    const notFoundErr = Object.assign(new Error("Not Found"), { status: 404 });
    const octokit = makeOctokit({
      reposGetContent: jest.fn().mockRejectedValue(notFoundErr),
    });
    const result = await fetchPrData(octokit, "owner", "repo", 1);
    expect(result.repoConfigContent).toBeNull();
  });

  it("falls back to null repoConfigContent on a 500 server error", async () => {
    const serverErr = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    const octokit = makeOctokit({
      reposGetContent: jest.fn().mockRejectedValue(serverErr),
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchPrData(octokit, "owner", "repo", 1);
    expect(result.repoConfigContent).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logArg = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logArg.event).toBe("repo_config_fetch_failed");
    warnSpy.mockRestore();
  });

  it("falls back to null repoConfigContent on an ECONNRESET network error", async () => {
    const connResetErr = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    const octokit = makeOctokit({
      reposGetContent: jest.fn().mockRejectedValue(connResetErr),
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fetchPrData(octokit, "owner", "repo", 1);
    expect(result.repoConfigContent).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("does not log a warning for a 404 (expected missing file)", async () => {
    const notFoundErr = Object.assign(new Error("Not Found"), { status: 404 });
    const octokit = makeOctokit({
      reposGetContent: jest.fn().mockRejectedValue(notFoundErr),
    });
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    await fetchPrData(octokit, "owner", "repo", 1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("retries transient listFiles failures and succeeds", async () => {
    const transientErr = Object.assign(
      new Error("HttpError: other side closed"),
      {
        status: 500,
      },
    );
    const pullsListFiles = jest
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({ data: [] });

    const octokit = makeOctokit({
      pullsListFiles,
      reposGetContent: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("Not Found"), { status: 404 }),
        ),
    });

    const result = await fetchPrData(octokit, "owner", "repo", 1);
    expect(result.metadata.number).toBe(1);
    expect(pullsListFiles).toHaveBeenCalledTimes(2);
  });
});
