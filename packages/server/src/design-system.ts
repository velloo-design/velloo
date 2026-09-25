import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DESIGN_MD_SECTIONS, markdownSections } from "@velloo/codegen";
import type { DesignFolder } from "./design-folder.ts";
import { hostAppRootFrom } from "./live/bundle-core.ts";
import { localDesignOf } from "./project-location.ts";

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
 * A design folder's own notes, when it has no repo `DESIGN.md` to follow — a
 * standalone design has nowhere else to state its intent.
 */
const GUIDANCE_FILENAME = "guidance.md";

const DESIGN_MD_NAMES = ["DESIGN.md", "design.md"];

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
  const headings = Object.keys(markdownSections(head)).map((h) => h.toLowerCase());
  const known = DESIGN_MD_SECTIONS.filter((s) =>
    headings.some((h) => h.startsWith(s.slice(0, 6).toLowerCase())),
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
 * The first `DESIGN.md` in `dirs` that reads as a design system, absolute.
 * `velloo init` looks with it before any design folder exists, so the file it
 * offers is one the folder will go on to follow.
 */
export function findDesignSystemIn(dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    for (const name of DESIGN_MD_NAMES) {
      const candidate = join(dir, name);
      if (sniff(candidate)) return candidate;
    }
  }
  return null;
}

/** The app root, or null when an `app:` root has no checkout bound here. */
function appRootOf(folder: DesignFolder): string | null {
  try {
    return hostAppRootFrom(folder.root, folder.config.hostApp);
  } catch {
    return null;
  }
}

/**
 * `config.designSystem.path` for a file, or null when it cannot be one: the
 * schema only admits paths inside the app root.
 */
export function designSystemConfigPath(folder: DesignFolder, absolutePath: string): string | null {
  const appRoot = appRootOf(folder);
  if (appRoot === null) return null;
  const rel = relative(appRoot, absolutePath);
  if (rel === "" || isAbsolute(rel) || rel.split(sep).includes("..")) return null;
  return rel.split(sep).join("/");
}

function doc(folder: DesignFolder, absolutePath: string): DesignSystemDoc {
  return { path: relative(folder.root, absolutePath).split(sep).join("/"), absolutePath };
}

/**
 * The folder's design-system document, or null. An explicit
 * `config.designSystem` wins; the schema has already confined it to the app.
 * Otherwise the conventional places are tried — the app root, the repo the
 * folder sits in, the folder itself — and each file must look the part.
 */
export function designSystemDoc(folder: DesignFolder): DesignSystemDoc | null {
  const appRoot = appRootOf(folder);
  const configured = folder.config.designSystem?.path;
  if (configured !== undefined) {
    return appRoot === null ? null : doc(folder, resolve(appRoot, configured));
  }
  // A local design lives in ~/.velloo, whose parent is nobody's repo.
  const repoDir = localDesignOf(folder.root) ? null : dirname(folder.root);
  const dirs = [...new Set([appRoot, repoDir].filter((d): d is string => d !== null))];
  const found = findDesignSystemIn([...dirs, folder.root]);
  if (found) return doc(folder, found);
  const guidance = join(folder.root, GUIDANCE_FILENAME);
  return sniff(guidance) ? doc(folder, guidance) : null;
}

/** The document's current text, read fresh. Null when it is gone or unreadable. */
export async function readDesignSystemDoc(folder: DesignFolder): Promise<string | null> {
  const found = designSystemDoc(folder);
  if (!found) return null;
  return readFile(found.absolutePath, "utf8").catch(() => null);
}
