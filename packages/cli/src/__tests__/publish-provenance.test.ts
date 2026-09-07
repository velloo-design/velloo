import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitContext,
  normalizeRemote,
  type PublishEvent,
  reportProvenance,
} from "../publish/core.ts";

/**
 * Keep the developer's own git setup out of these throwaway repos: a global
 * `core.hooksPath` would run that machine's pre-commit hook on the fixture
 * commit below, and a credential helper can block on a prompt that never
 * comes. Set on the process because `gitContext` spawns its own git.
 */
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_TERMINAL_PROMPT = "0";

// Each case scaffolds a real git repo with a chain of synchronous `git`
// subprocesses. Under `bun test --parallel` those queue behind every other
// worker's, and the 5s default starts tripping.
setDefaultTimeout(30_000);

const messages = (git: { repo: string | null; branch: string | null }): string[] => {
  const events: PublishEvent[] = [];
  reportProvenance(git, (event) => events.push(event));
  return events.map((event) => (event.kind === "info" ? event.message : `!${event.kind}`));
};

describe("reportProvenance", () => {
  test("names the repository and branch it recorded", () => {
    expect(messages({ repo: "github.com/velloo-design/velloo", branch: "main" })).toEqual([
      "source: github.com/velloo-design/velloo on main",
    ]);
  });

  test("explains a detached HEAD rather than dropping the branch silently", () => {
    expect(messages({ repo: "github.com/velloo-design/velloo", branch: null })[0]).toContain(
      "detached HEAD",
    );
  });

  // The case that sent a publish out with an empty Source and no explanation.
  test("explains a repository with no remote", () => {
    expect(messages({ repo: null, branch: "main" })).toEqual([
      "source: branch main — no git remote, publishing without a repository",
    ]);
  });

  test("explains a folder that is not a repository at all", () => {
    expect(messages({ repo: null, branch: null })).toEqual([
      "source: not a git repository — publishing without repository or branch",
    ]);
  });
});

describe("gitContext", () => {
  const git = (cwd: string, args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

  test("reports a branch with no repo when the repository has no remote", () => {
    const dir = mkdtempSync(join(tmpdir(), "velloo-prov-"));
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "T"]);
    writeFileSync(join(dir, "a.txt"), "a");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "first"]);

    expect(gitContext(dir)).toEqual({ repo: null, branch: "main" });
  });

  test("reports neither for a folder that is not a repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "velloo-nogit-"));
    expect(gitContext(dir)).toEqual({ repo: null, branch: null });
  });
});

describe("normalizeRemote", () => {
  test("collapses every remote spelling to host/owner/repo", () => {
    expect(normalizeRemote("git@github.com:velloo-design/velloo.git")).toBe(
      "github.com/velloo-design/velloo",
    );
    expect(normalizeRemote("https://github.com/velloo-design/velloo.git")).toBe(
      "github.com/velloo-design/velloo",
    );
    expect(normalizeRemote("ssh://git@github.com/velloo-design/velloo")).toBe(
      "github.com/velloo-design/velloo",
    );
  });

  // An ssh config Host alias is not resolved by git, so it survives into the
  // stored provenance — the cloud detects GitHub from the host word, not this.
  test("keeps an ssh host alias as written", () => {
    expect(normalizeRemote("git@github-work:velloo-design/velloo.git")).toBe(
      "github-work/velloo-design/velloo",
    );
  });

  test("returns null for a path remote, which names no host", () => {
    expect(normalizeRemote("/Users/someone/repos/thing")).toBeNull();
    expect(normalizeRemote("../sibling/repo")).toBeNull();
    expect(normalizeRemote("~/repos/thing")).toBeNull();
    expect(normalizeRemote("file:///Users/someone/repos/thing")).toBeNull();
    expect(normalizeRemote("C:\\repos\\thing")).toBeNull();
  });
});
