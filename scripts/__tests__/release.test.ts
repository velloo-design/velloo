import { describe, expect, test } from "bun:test";
import { compareVersions } from "../../packages/cli/src/release.ts";
import { prTitleProblem } from "../check-pr-title.ts";
import { releaseNotes } from "../release-notes.ts";
import { bumpVersion, devVersion, latestReleaseTag } from "../release-version.ts";

describe("release versions", () => {
  test("bumps reset the lower parts", () => {
    expect(bumpVersion("0.1.3", "patch")).toBe("0.1.4");
    expect(bumpVersion("0.1.3", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.3", "major")).toBe("1.0.0");
  });

  test("the latest release tag is chosen by semver, not by listing order", () => {
    expect(latestReleaseTag(["v0.9.0", "v0.10.0", "v0.2.1", "dev", "v1.0.0-rc.1"])).toBe("v0.10.0");
    expect(latestReleaseTag(["dev"])).toBeNull();
  });

  // The update check compares these with the CLI's own comparator, so that is
  // the one the ordering has to hold under.
  test("dev builds sort after the release they build on and after each other", () => {
    expect(compareVersions(devVersion("0.2.0", 0), "0.2.0")).toBe(1);
    expect(compareVersions(devVersion("0.2.0", 10), devVersion("0.2.0", 9))).toBe(1);
    expect(compareVersions("0.2.1", devVersion("0.2.0", 40))).toBe(1);
    expect(compareVersions(devVersion("0.2.1", 1), devVersion("0.2.0", 40))).toBe(1);
  });
});

describe("release notes", () => {
  const commit = (subject: string, body = "") => ({ sha: "abcdef1234", subject, body });
  const opts = { version: "0.2.0", previous: "v0.1.0", repo: "velloo-design/velloo" };

  test("groups by type, skips housekeeping, and puts breaking changes first", () => {
    const notes = releaseNotes(
      [
        commit("fix(canvas): keep the selection"),
        commit("feat(mcp)!: rename the batch tool"),
        commit("chore: bump deps"),
        commit("feat: export boards"),
        commit("canvas: an old-style subject"),
      ],
      opts,
    );
    expect(notes.indexOf("## Breaking changes")).toBeLessThan(notes.indexOf("## Features"));
    expect(notes).toContain("- **mcp:** rename the batch tool (abcdef1)");
    expect(notes).toContain("- **canvas:** keep the selection (abcdef1)");
    expect(notes).toContain("- canvas: an old-style subject (abcdef1)");
    expect(notes).not.toContain("bump deps");
    expect(notes).toContain("compare/v0.1.0...v0.2.0");
  });

  test("a BREAKING CHANGE footer counts even on a housekeeping type", () => {
    const notes = releaseNotes(
      [commit("build: drop Node 20", "BREAKING CHANGE: needs Node 22")],
      opts,
    );
    expect(notes).toContain("## Breaking changes");
  });

  test("the first release has nothing to diff against", () => {
    expect(releaseNotes([], { ...opts, previous: null })).toContain("The first public release.");
  });
});

describe("PR titles", () => {
  test.each([
    "feat(cli)!: resolve designs from the directory a command runs in",
    "fix: keep canvases running through a rename",
    "docs(architecture): describe distribution as it is",
    "ci: fail when bun install would change bun.lock",
  ])("accepts %s", (title) => {
    expect(prTitleProblem(title)).toBeNull();
  });

  test.each([
    ["Harden SVG/CSS handling, resolve designs per directory", "not a Conventional Commits title"],
    ["feature(cli): add a thing", '"feature" is not a known type'],
    ["Fix(cli): capitalized type", '"Fix" is not a known type'],
    ["fix:missing space", "not a Conventional Commits title"],
    ["fix(cli):", "not a Conventional Commits title"],
  ])("rejects %s", (title, reason) => {
    expect(prTitleProblem(title)).toContain(reason);
  });

  test("a title the check accepts is one the release notes can file", () => {
    const notes = releaseNotes(
      [{ sha: "abcdef1234", subject: "feat(cli)!: resolve designs per directory (#12)", body: "" }],
      { version: "0.2.0", previous: "v0.1.0", repo: "velloo-design/velloo" },
    );
    expect(notes).toContain("## Breaking changes");
    expect(notes).toContain("**cli:** resolve designs per directory (#12)");
  });
});
