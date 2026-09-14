#!/usr/bin/env bun
/**
 * Release notes from the conventional-commit subjects since the last release.
 * They become the GitHub release body — the project's only changelog.
 *
 *   bun scripts/release-notes.ts                  # preview what the next release says
 *   bun scripts/release-notes.ts --version 0.2.0  # as release.yml publishes them
 */
import { git, latestReleaseTag, releaseTags } from "./release-version.ts";

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

type Section = "breaking" | "feat" | "fix" | "perf" | "other";

const TITLES: Record<Section, string> = {
  breaking: "Breaking changes",
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  other: "Other changes",
};

// Housekeeping nobody using the package would notice.
const SKIP = new Set(["chore", "ci", "test", "build", "style", "docs"]);
const KNOWN = new Set(["feat", "fix", "perf", "refactor", "revert"]);

export function releaseNotes(
  commits: Commit[],
  opts: { version?: string | undefined; previous: string | null; repo: string },
): string {
  const sections = new Map<Section, string[]>();
  for (const commit of commits) {
    const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(commit.subject);
    const type = match?.[1]?.toLowerCase();
    const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
    if (type && SKIP.has(type) && !breaking) continue;
    const section: Section = breaking
      ? "breaking"
      : type === "feat" || type === "fix" || type === "perf"
        ? type
        : "other";
    const text =
      match && type && KNOWN.has(type)
        ? `${match[2] ? `**${match[2]}:** ` : ""}${match[4]}`
        : commit.subject;
    const items = sections.get(section) ?? [];
    items.push(`- ${text} (${commit.sha.slice(0, 7)})`);
    sections.set(section, items);
  }

  const parts: string[] = [];
  if (opts.version) {
    parts.push(
      `Install with \`npm install -g velloo@${opts.version}\`, or \`curl -fsSL https://get.velloo.design/install.sh | bash\`.`,
    );
  }
  if (!opts.previous) {
    parts.push("The first public release.");
  } else {
    for (const section of ["breaking", "feat", "fix", "perf", "other"] as const) {
      const items = sections.get(section);
      if (items?.length) parts.push(`## ${TITLES[section]}\n\n${items.join("\n")}`);
    }
    if (parts.length === (opts.version ? 1 : 0)) parts.push("No user-facing changes.");
    const head = opts.version ? `v${opts.version}` : "main";
    parts.push(`**Full diff:** https://github.com/${opts.repo}/compare/${opts.previous}...${head}`);
  }
  return `${parts.join("\n\n")}\n`;
}

export function commitsSince(previous: string | null): Commit[] {
  if (!previous) return [];
  const log = git("log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", `${previous}..HEAD`);
  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", subject = "", body = ""] = record.split("\x1f");
      return { sha, subject, body };
    });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--version");
  const version = at >= 0 ? args[at + 1] : undefined;
  const previous = latestReleaseTag(releaseTags());
  process.stdout.write(
    releaseNotes(commitsSince(previous), {
      version,
      previous,
      repo: process.env.GITHUB_REPOSITORY ?? "velloo-design/velloo",
    }),
  );
}
