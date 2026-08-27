import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isCancel, multiselect, select } from "@clack/prompts";
import { BoardSchema, ScreenSchema } from "@velloo/schema";
import { findDesignConfig } from "./design-config.ts";
import { fail } from "./fail.ts";

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
}

/**
 * Resolve the design folder for a command. An explicit arg wins; otherwise
 * default to `./velloo`, then the cwd, then walk up for a `.design/config.json`
 * (so the command works from inside the folder or the app root). Fails with
 * guidance when nothing is found.
 */
export async function resolveDesignFolder(
  arg: string | undefined,
  cmd: string,
  opts: ResolveDesignFolderOptions = {},
): Promise<string> {
  const abort: (message: string) => never = opts.onFail ?? ((m) => fail(cmd, m));
  if (arg) {
    const explicit = resolve(arg);
    if (opts.requireConfig && !(await hasDesignConfig(explicit))) {
      abort(`${explicit} is not a velloo design folder (no .design/config.json).`);
    }
    return explicit;
  }
  const here = resolve(DEFAULT_FOLDER);
  if (await hasDesignConfig(here)) return here;
  if (await hasDesignConfig(resolve("."))) return resolve(".");
  const found = await findDesignConfig(resolve("."));
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
