import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { isCancel, multiselect, select } from "@clack/prompts";
import { BoardSchema, ScreenSchema } from "@velloo/schema";
import { findDesignConfig } from "./design-config.ts";
import { fail } from "./fail.ts";
import { type FoundManifest, findManifest, pickProject } from "./manifest.ts";

const DEFAULT_FOLDER = "velloo";

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
 * manifest (`velloo.json`) project name, else a path. Without an arg, a
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
    if (opts.requireConfig) {
      abort(`${explicit} is not a velloo design folder (no .design/config.json).`);
    }
    // A bare name that matches nothing is a typo'd project, not a folder path.
    if (repo && !arg.includes(sep)) {
      abort(
        `unknown project ${JSON.stringify(arg)} — ${repo.path} lists: ${[...repo.folders.keys()].join(", ")}. Pass a project name or a folder path.`,
      );
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
      out.push({ id: b.id, name: b.name || b.id, screens: b.frames.map((fr) => fr.screen) });
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
 * else (interactive) a multiselect with all preselected, else all boards. A
 * folder with no boards returns [] (callers fall back to all screens).
 */
export async function pickBoards(
  folder: string,
  arg: string | undefined,
  interactive: boolean,
  cmd: string,
): Promise<BoardEntry[]> {
  const boards = await listBoards(folder);
  if (boards.length === 0) return [];
  if (arg) {
    const ids = new Set(
      arg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const chosen = boards.filter((b) => ids.has(b.id));
    if (chosen.length === 0) {
      fail(cmd, `no boards matched "${arg}". Available: ${boards.map((b) => b.id).join(", ")}`);
    }
    return chosen;
  }
  if (!interactive || boards.length === 1) return boards;
  const chosen = await multiselect<string>({
    message: "Which boards to publish?",
    options: boards.map((b) => ({
      value: b.id,
      label: b.name,
      hint: `${b.screens.length} screen${b.screens.length === 1 ? "" : "s"}`,
    })),
    initialValues: boards.map((b) => b.id),
    required: false,
  });
  if (isCancel(chosen)) fail(cmd, "cancelled.");
  const set = new Set(chosen as string[]);
  return boards.filter((b) => set.has(b.id));
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
