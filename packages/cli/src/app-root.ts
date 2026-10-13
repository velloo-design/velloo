import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { APP_PATH_PREFIX, ConfigSchema } from "@velloo/schema";
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
 *     to the application root".
 *   - **in-repo** — `config.hostApp.root`, stored relative to the design
 *     folder.
 *
 * Either way the config holds two kinds of path that a new root can leave
 * wrong, in opposite directions: one written against the design folder (or
 * absolutely) keeps naming the same files, and one written against the
 * application root (`app:` references, alias targets, `codegen.componentsDir`)
 * moves with it. {@link planAppRootChange} decides, per path, which of the two
 * the correction means, and rewrites the ones whose notation says the other.
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
  /** Config values rewritten for the new root: field → old → new. */
  rewritten: { field: string; from: string; to: string }[];
  /** The local design record, when the folder is one. */
  local?: { id: string; root: string };
}

type Config = Awaited<ReturnType<typeof readConfig>>;

/**
 * A config value that names a place in or around the application.
 *
 * `folder` values resolve from the design folder (or are `app:` references);
 * `app` values are written against the application root. An alias target is an
 * `app` value with a wildcard on the end, which is put back as it was found.
 */
interface PathSlot {
  field: string;
  kind: "folder" | "app";
  value: string;
  /** Only a path that exists is rewritten — the list also takes package specifiers. */
  onlyIfExists?: boolean;
  set(next: string): void;
}

/** Every place the config says where the application's files are, but the root itself. */
function pathSlots(config: Config): PathSlot[] {
  const slots: PathSlot[] = [];
  for (const [name, app] of Object.entries(config.hostApps ?? {})) {
    slots.push({
      field: `hostApps.${name}.root`,
      kind: "folder",
      value: app.root,
      set: (next) => {
        app.root = next;
      },
    });
  }
  for (const [name, library] of Object.entries(config.libraries)) {
    if (library.source !== "in-repo") continue;
    slots.push({
      field: `libraries.${name}.componentsPath`,
      kind: "folder",
      value: library.componentsPath,
      set: (next) => {
        library.componentsPath = next;
      },
    });
  }
  const aliases = config.hostApp?.aliases;
  for (const [pattern, target] of Object.entries(aliases ?? {})) {
    slots.push({
      field: `hostApp.aliases["${pattern}"]`,
      kind: "app",
      value: target,
      set: (next) => {
        if (aliases) aliases[pattern] = next;
      },
    });
  }
  const include = config.hostApp?.components?.include;
  for (const [index, entry] of (include ?? []).entries()) {
    slots.push({
      field: `hostApp.components.include[${index}]`,
      kind: "app",
      value: entry,
      onlyIfExists: true,
      set: (next) => {
        if (include) include[index] = next;
      },
    });
  }
  const codegen = config.codegen;
  if (codegen?.componentsDir !== undefined) {
    slots.push({
      field: "codegen.componentsDir",
      kind: "app",
      value: codegen.componentsDir,
      set: (next) => {
        codegen.componentsDir = next;
      },
    });
  }
  return slots;
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
  const from = current.path;
  const to = resolve(newRoot);
  const change: AppRootChange = { from, to, rewritten: [] };
  const local = current.kind === "local" && current.localId !== undefined;

  if (current.kind === "local" && current.localId && current.checkout) {
    if (!isUnder(current.checkout, to)) {
      throw new Error(
        `An application root must live inside the design's checkout (${current.checkout}). ${to} is outside it.`,
      );
    }
    change.local = { id: current.localId, root: current.checkout };
  }

  const config = await readConfig(folder);
  // A local design's root is its machine record; `app:.` goes on meaning it.
  if (!local) {
    const stored = config.hostApp?.root;
    const next = toPosix(relative(folder, to));
    if (stored === undefined || (!isSentinel(stored) && next !== stored))
      change.rewritten.push({ field: "hostApp.root", from: stored ?? "(unset)", to: next });
  }

  // A root corrected to a folder inside itself (or back out to one that holds
  // it) is the same tree looked at from a different place, so a path that is
  // right about the disk is right about the application: `web/src/components`
  // was found from the monorepo root and is still where the components are
  // once the root is `web`. Between two unrelated directories there is no
  // such reading, and a path written against the old application follows it.
  const nested = isUnder(from, to) || isUnder(to, from);
  const staysPut = (abs: string, moved: string): boolean => {
    if (!nested) return false;
    const here = existsSync(abs);
    if (here !== existsSync(moved)) return here;
    return isUnder(to, abs);
  };

  for (const slot of pathSlots(config)) {
    if (isSentinel(slot.value)) continue;
    const appRef = slot.kind === "folder" && slot.value.startsWith(APP_PATH_PREFIX);
    // The wildcard an alias target ends in, with the slash before it.
    const tail = slot.kind === "app" ? (/\/?\*?$/.exec(slot.value)?.[0] ?? "") : "";
    const stored = slot.value.slice(0, slot.value.length - tail.length);
    const abs = slot.kind === "app" ? resolve(from, stored) : resolveAppPath(folder, stored);
    // Only what was expressed against the old application is the correction's
    // to move. Anything else points somewhere it says nothing about.
    if (!isUnder(from, abs)) continue;
    if (slot.onlyIfExists && !existsSync(abs)) continue;

    const stays = staysPut(abs, join(to, relative(from, abs)));
    // Written against the application root, a value already moves with it;
    // written against the design folder, it already stays. Only the other
    // outcome needs the value itself to change.
    const followsRoot = slot.kind === "app" || appRef;
    if (stays !== followsRoot) continue;

    let next: string;
    if (!stays) next = toPosix(relative(folder, join(to, relative(from, abs))));
    else {
      const rel = abs === to ? "" : toPosix(relative(to, abs));
      if (appRef) next = `${APP_PATH_PREFIX}${rel || "."}`;
      else next = rel === "" ? tail.replace(/^\//, "") || "." : `${rel}${tail}`;
    }
    if (next !== slot.value)
      change.rewritten.push({ field: slot.field, from: slot.value, to: next });
  }
  return change;
}

/** Apply a planned change. Callers stop the folder's daemon first. */
export async function applyAppRootChange(
  designFolder: string,
  change: AppRootChange,
): Promise<void> {
  const folder = resolve(designFolder);

  if (change.rewritten.length > 0) {
    const config = await readConfig(folder);
    const patch = new Map(change.rewritten.map((r) => [r.field, r.to]));
    const hostRoot = patch.get("hostApp.root");
    if (hostRoot !== undefined) {
      config.hostApp = config.hostApp ? { ...config.hostApp, root: hostRoot } : { root: hostRoot };
    }
    for (const slot of pathSlots(config)) {
      const next = patch.get(slot.field);
      if (next !== undefined) slot.set(next);
    }
    await writeJsonAtomic(join(folder, ".design", "config.json"), ConfigSchema.parse(config));
  }

  if (change.local) {
    await writeLocalDesign(change.local.id, {
      root: change.local.root,
      appRoot: change.to,
      ...(managedDesignId(folder) ? {} : { designPath: folder }),
    });
  }
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
