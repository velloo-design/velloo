#!/usr/bin/env bun
/**
 * The version a release or dev build publishes as. Git tags are the source of
 * truth: the repo's package.json is never bumped — it stays the version local
 * builds report — and CI stamps the computed version into its own checkout
 * with --write before building.
 *
 *   bun scripts/release-version.ts --bump minor   # the next release, e.g. 0.2.0
 *   bun scripts/release-version.ts --dev          # a dev build, e.g. 0.2.1-dev.14
 *
 * A dev build is a prerelease of the next patch numbered by commits since the
 * last release, so every later build of main sorts after every earlier one and
 * after the release it builds on.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Bump = "patch" | "minor" | "major";

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function bumpVersion(base: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(base);
  if (!match) throw new Error(`not a semver version: ${base}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function devVersion(base: string, commitsSinceRelease: number): string {
  return `${bumpVersion(base, "patch")}-dev.${commitsSinceRelease}`;
}

/** The newest `vX.Y.Z` tag by semver; prerelease and non-version tags don't count. */
export function latestReleaseTag(tags: string[]): string | null {
  const parsed = tags.flatMap((tag) => {
    const match = STABLE_TAG.exec(tag);
    return match ? [{ tag, parts: [Number(match[1]), Number(match[2]), Number(match[3])] }] : [];
  });
  parsed.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      const delta = (b.parts[i] ?? 0) - (a.parts[i] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  });
  return parsed[0]?.tag ?? null;
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
  if (!result.success) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

export function releaseTags(): string[] {
  return git("tag", "--list", "v*").split("\n").filter(Boolean);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const cliManifest = join(repoRoot, "packages", "cli", "package.json");
  const tag = latestReleaseTag(releaseTags());
  // Before the first tag, the version the repo carries is the last one shipped.
  const base: string = tag ? tag.slice(1) : JSON.parse(readFileSync(cliManifest, "utf8")).version;

  let version: string;
  if (args.includes("--dev")) {
    version = devVersion(base, Number(git("rev-list", "--count", tag ? `${tag}..HEAD` : "HEAD")));
  } else {
    const bump = option("--bump");
    if (bump !== "patch" && bump !== "minor" && bump !== "major") {
      console.error("usage: release-version.ts --bump patch|minor|major | --dev [--write]");
      process.exit(2);
    }
    // A re-run of a release whose tag already landed resumes it instead of
    // cutting another version on top of the same commit.
    const onHead = git("tag", "--points-at", "HEAD").split("\n");
    if (tag && onHead.includes(tag)) {
      console.error(`HEAD is already ${tag} — resuming that release`);
      version = base;
    } else {
      version = bumpVersion(base, bump);
    }
  }

  if (args.includes("--write")) {
    for (const path of [cliManifest, join(repoRoot, "package.json")]) {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.version = version;
      writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${version}\ntag=v${version}\nprevious=${tag ?? ""}\n`,
    );
  }
  console.log(version);
}
