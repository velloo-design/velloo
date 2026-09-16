#!/usr/bin/env bun
/**
 * Fail a pull request whose title isn't a Conventional Commits subject.
 *
 * PRs are squash-merged, so the title becomes the commit subject on main and
 * the line `release-notes.ts` files into the GitHub release. A title it can't
 * parse lands under "Other changes", and a breaking change it can't see isn't
 * announced at all.
 *
 *   PR_TITLE="feat(cli)!: resolve designs per directory" bun scripts/check-pr-title.ts
 */
import { CONVENTIONAL_TYPES, parseSubject } from "./release-notes.ts";

const EXAMPLE = "fix(cli): keep canvases running through a rename";

/** Why `title` can't be merged as-is, or null when it can. */
export function prTitleProblem(title: string): string | null {
  const types = [...CONVENTIONAL_TYPES].sort().join(", ");
  const parsed = parseSubject(title.trim());
  if (!parsed) {
    return `"${title}" is not a Conventional Commits title. Use \`type(scope): description\`, e.g. \`${EXAMPLE}\`; mark a breaking change with \`!\` before the colon (\`feat(cli)!: …\`). Types: ${types}.`;
  }
  if (!CONVENTIONAL_TYPES.has(parsed.type)) {
    return `"${parsed.type}" is not a known type (types are lowercase): ${types}.`;
  }
  return null;
}

if (import.meta.main) {
  const title = process.env.PR_TITLE ?? "";
  const problem = prTitleProblem(title);
  if (problem) {
    console.error(`::error title=PR title::${problem}`);
    process.exit(1);
  }
  console.error(`PR title OK: ${title}`);
}
