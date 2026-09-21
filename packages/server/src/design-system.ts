import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DESIGN_MD_SECTIONS } from "@velloo/codegen";
import type { DesignFolder } from "./design-folder.ts";
import { hostAppRootFrom } from "./live/bundle-core.ts";

/**
 * The design-system document a folder follows — the repo's `DESIGN.md`.
 *
 * Resolved and read live, never copied in. The file is the repo's, it keeps
 * being edited there, and a snapshot taken at import time would quietly stop
 * matching the rules it claims to state. So nothing here caches: a session
 * that starts with `velloo run` sees whatever the file says at the moment it
 * is asked, including edits made while the daemon is up.
 *
 * Velloo reads this file and never writes it.
 */

export interface DesignSystemDoc {
  /** Path relative to the design folder, for showing a human. */
  path: string;
  absolutePath: string;
}

/**
 * Where a DESIGN.md conventionally sits, relative to the design folder. The
 * folder normally lives at `<appRoot>/velloo`, and the file next to the app's
 * README — which is also where designmd.ai tells people to drop one.
 */
const CONVENTIONAL = ["../DESIGN.md", "../design.md", "DESIGN.md", "guidance.md"];

/**
 * Does this file look like a design system, or just share the name?
 *
 * Worth checking: `DESIGN.md` is a common name for an architecture document,
 * and pointing the design agents at someone's database schema would be worse
 * than pointing them at nothing. Frontmatter with a `name:` settles it; so
 * does prose carrying the spec's own section vocabulary, which is how the
 * files on designmd.ai are written — they have no frontmatter at all, and the
 * spec says that half is optional.
 */
function looksLikeDesignSystem(head: string): boolean {
  if (/^---\r?\n/.test(head) && /^name:/m.test(head)) return true;
  const headings = new Set(
    [...head.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((m) => (m[1] as string).trim().toLowerCase()),
  );
  const known = DESIGN_MD_SECTIONS.filter((s) =>
    [...headings].some((h) => h.startsWith(s.slice(0, 6).toLowerCase())),
  );
  return known.length >= 2;
}

function sniff(absolutePath: string): boolean {
  try {
    return looksLikeDesignSystem(readFileSync(absolutePath, "utf8").slice(0, 4096));
  } catch {
    return false;
  }
}

/**
 * The folder's design-system document, or null. An explicit `config.designSystem`
 * wins and is trusted as-is — the user named it on purpose. Otherwise the
 * conventional locations are tried, and each must look the part.
 */
export function designSystemDoc(folder: DesignFolder): DesignSystemDoc | null {
  const configured = folder.config.designSystem?.path;
  if (configured !== undefined) {
    const absolutePath = isAbsolute(configured) ? configured : resolve(folder.root, configured);
    return { path: configured, absolutePath };
  }
  const candidates = [...CONVENTIONAL];
  const hostRoot = folder.config.hostApp?.root;
  if (hostRoot) {
    candidates.push(
      relative(folder.root, join(hostAppRootFrom(folder.root, folder.config.hostApp), "DESIGN.md")),
    );
  }
  for (const candidate of candidates) {
    const absolutePath = resolve(folder.root, candidate);
    if (sniff(absolutePath)) return { path: candidate, absolutePath };
  }
  return null;
}

/** The document's current text, read fresh. Null when it is gone or unreadable. */
export async function readDesignSystemDoc(folder: DesignFolder): Promise<string | null> {
  const doc = designSystemDoc(folder);
  if (!doc) return null;
  return readFile(doc.absolutePath, "utf8").catch(() => null);
}
