import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isCancel, multiselect, select } from "@clack/prompts";
import { BoardSchema, isArchived, ScreenSchema } from "@velloo/schema";
import { findDesignConfig } from "./design-config.ts";
import { fail } from "./fail.ts";
import { type FoundManifest, findManifest, pickProject } from "./manifest.ts";

const DEFAULT_FOLDER = "velloo";

/**
 * Shared help text for every folder-taking command, so the root model reads
 * the same everywhere: `velloo.json` marks the repo root and names design
 * folders as projects; `.design/config.json` marks a design folder.
 */
export const FOLDER_ARG_DESCRIPTION =
  "A velloo.json project name or a design-folder path (default: resolve via velloo.json, else ./velloo or the nearest design folder above the cwd)";

/**
 * Sync twins of {@link hasDesignConfig} and the empty-folder check, for
 * clack `validate` callbacks — those run synchronously, and the folder prompt
 * needs the answer before it accepts a path.
 */
export function isDesignFolderSync(dir: string): boolean {
  return existsSync(join(dir, ".design", "config.json"));
}

export function isEmptyOrMissingSync(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

/** True when `dir` already holds a Velloo design (has `.design/config.json`). */
export async function hasDesignConfig(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, ".design", "config.json"), "utf8");
    return true;
  } catch {
    return false;
  }
}

export interface ResolveDesignFolderOptions {
  /** Reject an explicit arg that isn't a design folder (default: accept it unchecked). */
  requireConfig?: boolean;
  /** Abort override — `velloo ci` exits 2 for operational errors, not fail()'s 1. */
  onFail?: (message: string) => never;
  /**
   * Offer a picker when the repo manifest lists several projects and nothing
   * disambiguates (TTY only). Commands that own stdio (mcp) or run headless
   * (ci) must leave this off.
   */
  interactive?: boolean;
  /** Resolution base (default: process.cwd()) — injectable so tests avoid chdir. */
  cwd?: string;
}

/** A manifest entry must point at a real design folder — fail loud on a stale path. */
async function manifestProject(
  repo: FoundManifest,
  name: string,
  abort: (message: string) => never,
): Promise<string> {
  const folder = repo.folders.get(name) as string;
  if (!(await hasDesignConfig(folder))) {
    abort(
      `project ${JSON.stringify(name)} in ${repo.path} points at ${folder}, which is not a velloo design folder (no .design/config.json).`,
    );
  }
  return folder;
}

/**
 * Resolve the design folder for a command. An explicit arg wins — a repo
 * manifest (`velloo.json`) project name, else a path. A path that is the
 * app/repo root (not the design folder itself) still resolves via the same
 * `./velloo` convention as standing there with no arg. Without an arg, a
 * manifest drives resolution (cwd containment → the only project →
 * defaultProject → picker/fail); repos without one keep the convention chain:
 * `./velloo`, then the cwd, then walk up for a `.design/config.json` (so the
 * command works from inside the folder or the app root). Fails with guidance
 * when nothing is found.
 */
export async function resolveDesignFolder(
  arg: string | undefined,
  cmd: string,
  opts: ResolveDesignFolderOptions = {},
): Promise<string> {
  const abort: (message: string) => never = opts.onFail ?? ((m) => fail(cmd, m));
  const cwd = resolve(opts.cwd ?? ".");

  let repo: FoundManifest | null = null;
  try {
    repo = await findManifest(cwd);
  } catch (err) {
    abort((err as Error).message);
  }

  if (arg) {
    if (repo && !arg.includes(sep) && repo.folders.has(arg)) {
      return manifestProject(repo, arg, abort);
    }
    const explicit = resolve(cwd, arg);
    if (await hasDesignConfig(explicit)) return explicit;
    // App root passed as a path — same as `cd` there with no arg.
    const nested = join(explicit, DEFAULT_FOLDER);
    if (await hasDesignConfig(nested)) return nested;
    // A bare name that matches nothing is a typo'd project, not a folder path —
    // suggest the real names even for commands that require a config.
    if (repo && !arg.includes(sep)) {
      abort(
        `unknown project ${JSON.stringify(arg)} — ${repo.path} lists: ${[...repo.folders.keys()].join(", ")}. Pass a project name or a folder path.`,
      );
    }
    if (opts.requireConfig) {
      abort(`${explicit} is not a velloo design folder (no .design/config.json).`);
    }
    return explicit;
  }

  if (repo && repo.folders.size > 0) {
    // Standing inside a design folder beats the manifest — you cd'd here.
    if (await hasDesignConfig(cwd)) return cwd;
    const picked = pickProject(repo, cwd);
    if (picked) return manifestProject(repo, picked, abort);
    const names = [...repo.folders.keys()];
    if (opts.interactive && process.stdin.isTTY) {
      const chosen = await select<string>({
        message: "Which project?",
        options: names.map((n) => ({
          value: n,
          label: n,
          hint: relative(cwd, repo.folders.get(n) as string),
        })),
      });
      if (isCancel(chosen)) abort("cancelled.");
      return manifestProject(repo, chosen as string, abort);
    }
    abort(
      `${repo.path} lists several projects: ${names.join(", ")}. Pass one (e.g. \`velloo ${cmd} ${names[0]}\`) or set "defaultProject".`,
    );
  }

  const here = join(cwd, DEFAULT_FOLDER);
  if (await hasDesignConfig(here)) return here;
  if (await hasDesignConfig(cwd)) return cwd;
  const found = await findDesignConfig(cwd);
  if (found) return found.folder;
  abort(
    `no design folder found. Pass one (e.g. \`velloo ${cmd} ./velloo\`), run from a folder that contains a Velloo design, or \`velloo init\` first.`,
  );
}

export interface ScreenEntry {
  id: string;
  name: string;
  path: string;
}

/** Every screen under `<folder>/screens`, sorted; skips unparseable files. */
export async function listScreens(folder: string): Promise<ScreenEntry[]> {
  let files: string[];
  try {
    files = (await readdir(join(folder, "screens"))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ScreenEntry[] = [];
  for (const f of files.sort()) {
    const path = join(folder, "screens", f);
    try {
      const s = ScreenSchema.parse(JSON.parse(await readFile(path, "utf8")));
      out.push({ id: s.id, name: s.name || s.id, path });
    } catch {
      // skip a malformed/partial screen rather than abort the whole picker
    }
  }
  return out;
}

export interface BoardEntry {
  id: string;
  name: string;
  /** Screen ids placed on this board (from its frames). */
  screens: string[];
  /** Archived boards stay out of the default publish set — see {@link pickBoards}. */
  archived: boolean;
}

/** Every board under `<folder>/boards`, sorted; skips unparseable files. */
export async function listBoards(folder: string): Promise<BoardEntry[]> {
  let files: string[];
  try {
    files = (await readdir(join(folder, "boards"))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: BoardEntry[] = [];
  for (const f of files.sort()) {
    try {
      const b = BoardSchema.parse(JSON.parse(await readFile(join(folder, "boards", f), "utf8")));
      out.push({
        id: b.id,
        name: b.name || b.id,
        screens: b.frames.map((fr) => fr.screen),
        archived: isArchived(b),
      });
    } catch {
      // skip a malformed board rather than abort
    }
  }
  return out;
}

/** screen id → the names of the boards it appears on. */
export function boardsByScreen(boards: BoardEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const b of boards) {
    for (const sid of b.screens) {
      const names = map.get(sid) ?? [];
      names.push(b.name);
      map.set(sid, names);
    }
  }
  return map;
}

/**
 * Resolve the boards a command should act on: an explicit `--boards a,b` arg,
 * else (interactive) an empty multiselect, else all live boards. An explicitly
 * empty interactive choice returns null so callers can stop without confusing
 * it with a folder that has no boards, which returns [] (all screens).
 *
 * Archived boards are out of the default and the picker, but a `--boards` arg
 * naming one still resolves — asking for it by id is deliberate.
 */
export async function pickBoards(
  folder: string,
  arg: string | undefined,
  interactive: boolean,
  cmd: string,
): Promise<BoardEntry[] | null> {
  const all = await listBoards(folder);
  if (all.length === 0) return [];
  if (arg) {
    const ids = new Set(
      arg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const chosen = all.filter((b) => ids.has(b.id));
    if (chosen.length === 0) {
      fail(cmd, `no boards matched "${arg}". Available: ${all.map((b) => b.id).join(", ")}`);
    }
    return chosen;
  }
  const boards = all.filter((b) => !b.archived);
  if (boards.length === 0) return [];
  if (!interactive) return boards;
  const chosen = await multiselect<string>(boardSelectionPrompt(boards));
  if (isCancel(chosen)) fail(cmd, "cancelled.");
  return resolveBoardSelection(boards, chosen as string[]);
}

/** Prompt configuration kept separate so its empty default and bulk key are testable. */
export function boardSelectionPrompt(boards: BoardEntry[]) {
  return {
    message: "Which boards to publish? (a: select all / clear all)",
    options: boards.map((board) => ({
      value: board.id,
      label: board.name,
      hint: `${board.screens.length} screen${board.screens.length === 1 ? "" : "s"}`,
    })),
    initialValues: [] as string[],
    required: false,
  };
}

/** Empty means the user confirmed that nothing should be published. */
export function resolveBoardSelection(
  boards: BoardEntry[],
  selectedIds: string[],
): BoardEntry[] | null {
  const selected = new Set(selectedIds);
  const chosen = boards.filter((board) => selected.has(board.id));
  return chosen.length > 0 ? chosen : null;
}

/**
 * Resolve a screen for a command: an explicit id/path arg, else (interactive) a
 * picker over the folder's screens, else fail. With exactly one screen the
 * picker is skipped. The picker hint shows which board(s) each screen is on.
 */
export async function pickScreen(
  folder: string,
  arg: string | undefined,
  interactive: boolean,
  cmd: string,
): Promise<ScreenEntry> {
  const screens = await listScreens(folder);
  if (arg) {
    const byId = screens.find((s) => s.id === arg);
    if (byId) return byId;
    // Treat the arg as a path (back-compat with the old `screen` positional).
    return { id: arg, name: arg, path: resolve(arg) };
  }
  if (screens.length === 0) fail(cmd, `no screens found in ${folder}/screens.`);
  if (screens.length === 1) return screens[0] as ScreenEntry;
  if (!interactive) {
    fail(cmd, `pick a screen: ${screens.map((s) => s.id).join(", ")}`);
  }
  const onBoard = boardsByScreen(await listBoards(folder));
  const chosen = await select<string>({
    message: "Which screen?",
    options: screens.map((s) => ({
      value: s.id,
      label: s.name,
      hint: onBoard.get(s.id)?.join(", ") ?? `${s.id}.json`,
    })),
  });
  if (isCancel(chosen)) fail(cmd, "cancelled.");
  return screens.find((s) => s.id === chosen) as ScreenEntry;
}
