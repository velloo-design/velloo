import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { ConfigSchema } from "@velloo/schema";
import {
  localDesignOf,
  managedDesignId,
  recordedDesignName,
  resolveAppPath,
  writeJsonAtomic,
  writeLocalDesign,
} from "@velloo/server";
import { findGitRoot, findManifest, manifestListing } from "./manifest.ts";
import { discoverScanRoots } from "./scan/discover.ts";

/**
 * The application a design folder points at.
 *
 * `init` records it from the directory it was run in, and until now nothing
 * could change it afterwards — a folder scaffolded from a monorepo root, or
 * from one app when the design was meant for another, had no supported repair.
 * The only escape was hand-editing files the folder declares tool-owned, which
 * is the one thing every agent is told never to do.
 *
 * Where it lives depends on the folder's kind, so the two shapes are read and
 * written through this one module:
 *
 *   - **local** (outside the checkout) — the machine-local record's `appRoot`.
 *     Design paths are stored as `app:` references, which mean "relative
 *     to the application root" and therefore follow it with no rewriting.
 *   - **in-repo** — `config.hostApp.root`, stored relative to the design
 *     folder. Nothing expresses "the app root" symbolically, so the paths that
 *     were *under* the old root are re-anchored onto the new one.
 */
export interface RecordedAppRoot {
  /** Absolute path currently recorded. */
  path: string;
  /** How the folder stores it, which decides what a change has to write. */
  kind: "local" | "in-repo";
  /** Local design id, when `kind` is "local". */
  localId?: string;
  /** The checkout a local design belongs to. */
  checkout?: string;
  /** The design's name. */
  designName?: string;
  /** Absolute path of the manifest that registers it, when there is one. */
  manifestPath?: string;
  /** False when `path` no longer exists on disk. */
  exists: boolean;
  /** False when `path` exists but holds no `package.json`. */
  looksLikeApp: boolean;
}

/** Sentinels `rebaseDesignConfig` leaves alone; neither is a filesystem path we own. */
function isSentinel(path: string): boolean {
  return path === "binary" || path.startsWith("~/");
}

function toPosix(path: string): string {
  return path.split(sep).join("/") || ".";
}

/** True when `child` is `parent` or sits underneath it. */
function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !/^(?:[\\/]|[A-Za-z]:)/.test(rel));
}

async function readConfig(folder: string) {
  return ConfigSchema.parse(
    JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
  );
}

/**
 * What application the folder currently points at. Deliberately tolerant of a
 * root that has gone missing: that is precisely the state this exists to
 * repair.
 */
export async function recordedAppRoot(designFolder: string): Promise<RecordedAppRoot> {
  const folder = resolve(designFolder);
  const local = localDesignOf(folder);
  if (local) {
    const path = resolve(local.appRoot);
    return {
      path,
      kind: "local",
      localId: local.id,
      checkout: local.root,
      ...appShape(path),
    };
  }

  const config = await readConfig(folder);
  const recorded = config.hostApp?.root;
  // No `hostApp` at all is the pre-live-islands default the bundler still
  // assumes: the design folder's parent.
  const path =
    recorded && !isSentinel(recorded) ? resolveAppPath(folder, recorded) : resolve(folder, "..");
  const found = await manifestListing(folder).catch(() => null);
  const designName = recordedDesignName(folder);
  return {
    path,
    kind: "in-repo",
    ...(designName ? { designName } : {}),
    ...(found ? { manifestPath: found.path } : {}),
    ...appShape(path),
  };
}

function appShape(path: string): { exists: boolean; looksLikeApp: boolean } {
  const exists = existsSync(path);
  return { exists, looksLikeApp: exists && existsSync(join(path, "package.json")) };
}

export interface AppRootChange {
  from: string;
  to: string;
  /** Config paths re-anchored onto the new root: field → old → new. */
  rewritten: { field: string; from: string; to: string }[];
  /** The local design record, when the folder is one — the only thing that changes. */
  local?: { id: string; root: string };
}

/**
 * Plan the change without writing it, so callers can show it first — the same
 * preview-then-`--yes` shape `design move` and `design bind` use.
 */
export async function planAppRootChange(
  designFolder: string,
  newRoot: string,
): Promise<AppRootChange> {
  const folder = resolve(designFolder);
  const current = await recordedAppRoot(folder);
  const to = resolve(newRoot);
  const change: AppRootChange = { from: current.path, to, rewritten: [] };

  if (current.kind === "local" && current.localId && current.checkout) {
    if (!isUnder(current.checkout, to)) {
      throw new Error(
        `An application root must live inside the design's checkout (${current.checkout}). ${to} is outside it.`,
      );
    }
    // `app:` paths already mean "under the application root", so they
    // follow the move; only the pointer to the root itself changes.
    change.local = { id: current.localId, root: current.checkout };
    return change;
  }

  const config = await readConfig(folder);
  const reanchor = (field: string, stored: string): string | undefined => {
    if (isSentinel(stored)) return undefined;
    const abs = resolveAppPath(folder, stored);
    // Only paths that were expressed against the old application follow it.
    // Anything else points somewhere the correction says nothing about.
    if (!isUnder(current.path, abs)) return undefined;
    const next = toPosix(relative(folder, join(to, relative(current.path, abs))));
    if (next === stored) return undefined;
    change.rewritten.push({ field, from: stored, to: next });
    return next;
  };

  if (config.hostApp) reanchor("hostApp.root", config.hostApp.root);
  else
    change.rewritten.push({
      field: "hostApp.root",
      from: "(unset)",
      to: toPosix(relative(folder, to)),
    });
  for (const [name, app] of Object.entries(config.hostApps ?? {})) {
    reanchor(`hostApps.${name}.root`, app.root);
  }
  for (const [name, library] of Object.entries(config.libraries)) {
    if (library.source === "in-repo")
      reanchor(`libraries.${name}.componentsPath`, library.componentsPath);
  }
  return change;
}

/** Apply a planned change. Callers stop the folder's daemon first. */
export async function applyAppRootChange(
  designFolder: string,
  change: AppRootChange,
): Promise<void> {
  const folder = resolve(designFolder);

  if (change.local) {
    await writeLocalDesign(change.local.id, {
      root: change.local.root,
      appRoot: change.to,
      ...(managedDesignId(folder) ? {} : { designPath: folder }),
    });
    return;
  }

  const config = await readConfig(folder);
  const patch = new Map(change.rewritten.map((r) => [r.field, r.to]));
  const hostRoot = patch.get("hostApp.root");
  if (hostRoot !== undefined) {
    config.hostApp = config.hostApp ? { ...config.hostApp, root: hostRoot } : { root: hostRoot };
  }
  for (const [name, app] of Object.entries(config.hostApps ?? {})) {
    const next = patch.get(`hostApps.${name}.root`);
    if (next !== undefined) app.root = next;
  }
  for (const [name, library] of Object.entries(config.libraries)) {
    const next = patch.get(`libraries.${name}.componentsPath`);
    if (next !== undefined) library.componentsPath = next;
  }
  await writeJsonAtomic(join(folder, ".design", "config.json"), ConfigSchema.parse(config));
}

/**
 * The applications a repo actually contains, best-ranked first — the answers
 * worth offering when the recorded root is wrong. Searched from the repo root
 * rather than from the recorded root, so an app that is a *sibling* of a bad
 * answer is still reachable.
 */
async function appRootCandidates(near: string): Promise<{ dir: string; rel: string }[]> {
  const start = resolve(near);
  const root = (await findManifest(start).catch(() => null))?.dir ?? (await findGitRoot(start));
  const from = root ?? start;
  const apps = await discoverScanRoots(from);
  return apps.map((app) => ({ dir: app.dir, rel: relative(from, app.dir) || "." }));
}

/**
 * `init` records the application root from the directory it was run in, and a
 * monorepo root is a directory people run it in. This is the provable half of
 * that mistake: the repo holds UI apps and the recorded root is not one of
 * them, so it is not the application whatever else it may be.
 */
export async function appRootIsNotAnApp(
  appRoot: string,
): Promise<{ dir: string; rel: string }[] | null> {
  const abs = resolve(appRoot);
  if (existsSync(join(abs, "package.json")) && (await discoverScanRoots(abs))[0]?.dir === abs)
    return null;
  const candidates = (await appRootCandidates(abs)).filter((c) => c.dir !== abs);
  return candidates.length > 0 ? candidates : null;
}

/**
 * Offer the repo's apps, plus the chance to keep what's recorded. Returns the
 * chosen absolute directory, or null when the user backed out.
 */
export async function promptAppRootChoice(
  current: string,
  opts: { message?: string; currentHint?: string } = {},
): Promise<string | null> {
  const message = opts.message ?? "Which application is this design for?";
  const currentHint = opts.currentHint ?? "recorded now";
  const abs = resolve(current);
  const candidates = await appRootCandidates(abs);
  const options = candidates.map((c) => ({
    value: c.dir,
    label: c.rel,
    ...(c.dir === abs ? { hint: currentHint } : {}),
  }));
  if (!candidates.some((c) => c.dir === abs))
    options.push({ value: abs, label: current, hint: currentHint });
  if (options.length <= 1) return null;
  const chosen = await select({ message, options });
  if (isCancel(chosen)) return null;
  return chosen as string;
}
