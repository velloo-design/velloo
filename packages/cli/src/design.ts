import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isCancel, multiselect, select } from "@clack/prompts";
import { BoardSchema, isArchived, ScreenSchema } from "@velloo/schema";
import {
  type DesignEntry,
  type DesignPickReason,
  type DesignSet,
  listLocalDesigns,
  pickDesign,
  recordedDesignName,
} from "@velloo/server";
import { fail } from "./fail.ts";
import { discoverDesignFolders, findDesigns } from "./manifest.ts";

const DEFAULT_FOLDER = "velloo";

/**
 * Shared help text for every design-taking command, so the model reads the
 * same everywhere: a design is named in its `.design/config.json`, and
 * `velloo.json` (or this machine's record, for a design outside the repo) says
 * where it is.
 */
export const DESIGN_ARG_DESCRIPTION =
  "A design name from ./velloo.json, a design folder, or a velloo.json file or its directory (default: the design folder you're in, else this directory's velloo.json: its only design or defaultDesign)";

/**
 * A design folder the repo already has — the first listed, else the first one
 * on disk. `velloo design add` reads its library and components dir so the new
 * design agrees with its siblings about the app.
 */
export async function existingDesignFolder(appRoot: string): Promise<string | null> {
  try {
    const found = await findDesigns(appRoot);
    for (const design of found?.designs ?? []) {
      if (design.exists) return design.root;
    }
  } catch {
    // A broken manifest is someone else's error to report.
  }
  const conventional = join(resolve(appRoot), DEFAULT_FOLDER);
  if (await hasDesignConfig(conventional)) return conventional;
  const [first] = await discoverDesignFolders(resolve(appRoot));
  return first ?? null;
}

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

export interface ResolveDesignOptions {
  /** Reject an explicit arg that isn't a design folder (default: accept it unchecked). */
  requireConfig?: boolean | undefined;
  /** Abort override for commands that need a non-default operational exit code. */
  onFail?: ((message: string) => never) | undefined;
  /**
   * Offer a picker when the checkout has several designs and nothing
   * disambiguates (TTY only). Commands that own stdio (mcp) or run headless
   * must leave this off.
   */
  interactive?: boolean | undefined;
  /** Resolution base (default: process.cwd()) — injectable so tests avoid chdir. */
  cwd?: string | undefined;
  /**
   * How the command takes a design, for the examples in its errors: as a
   * positional (default) or behind a flag such as `--folder`.
   */
  designFlag?: string | undefined;
  /** False for a command that takes no design (`design list`): its errors show no example. */
  takesDesign?: boolean | undefined;
  /**
   * The design's number in `velloo design list` — a short handle for a name
   * with spaces or emoji. Numbers follow the list's name order, so they shift
   * when a design is added, removed or renamed.
   */
  id?: string | undefined;
}

/** The `--id` argument every design-taking `velloo design` subcommand shares. */
export const DESIGN_ID_ARG = {
  type: "string",
  description: "The design's number in `velloo design list`, instead of its name or path",
} as const;

/**
 * A named design must point at a real design folder — fail loud on a stale
 * path. A `velloo.json` entry must also stay inside its repository: the file is
 * committed, and a cloned repo must not be able to aim Velloo elsewhere.
 */
async function designFolder(
  set: DesignSet,
  design: DesignEntry,
  abort: (message: string) => never,
): Promise<string> {
  const repo = set.repo;
  if (repo && design.outsideRepo) {
    const entry = relative(repo.dir, design.root);
    abort(
      `design ${JSON.stringify(design.name)} in ${repo.path} points outside the repository (${entry}), which velloo.json cannot authorize. Pass the design path explicitly, or run \`velloo design bind ${design.root}\` here to keep it as a local design on this machine.`,
    );
  }
  if (!design.exists) {
    abort(
      `design ${JSON.stringify(design.name)} ${design.local ? "(a local design)" : `in ${repo?.path}`} points at ${design.root}, which is not a velloo design folder (no .design/config.json).`,
    );
  }
  return design.root;
}

/** A shell argument as someone would type it: bare when safe, else single-quoted. */
function quoteArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function designsLabel(set: DesignSet): string {
  return set.repo?.path ?? "this checkout's local designs";
}

/** Look a design up by name, failing with guidance when the name is shared. */
function byName(
  set: DesignSet,
  name: string,
  abort: (message: string) => never,
): DesignEntry | undefined {
  const shared = set.conflicts.get(name);
  if (shared) {
    abort(
      `${shared.length} designs are named ${JSON.stringify(name)}: ${shared.map((d) => d.root).join(", ")}. Pass a path, and rename one with \`velloo design rename <path> <new-name>\`.`,
    );
  }
  return set.byName.get(name);
}

/**
 * Resolve the design for a command, from exactly where it runs — no directory
 * above it is searched, so a project nested in another (`app/admin` inside
 * `app`) never picks up its parent's designs.
 *
 * An explicit arg wins: a design name from this directory's `velloo.json`, a
 * design folder, a directory holding a `velloo.json`, or that file itself.
 * Without one: the design folder you're standing in, else this directory's
 * designs (the only one → defaultDesign → picker/fail), else `./velloo`.
 */
export async function resolveDesign(
  arg: string | undefined,
  cmd: string,
  opts: ResolveDesignOptions = {},
): Promise<string> {
  const abort: (message: string) => never = opts.onFail ?? ((m) => fail(cmd, m));
  const cwd = resolve(opts.cwd ?? ".");

  let set: DesignSet | null = null;
  try {
    set = await findDesigns(cwd);
  } catch (err) {
    abort((err as Error).message);
  }

  if (opts.id !== undefined) {
    if (arg) abort("pass a design or --id, not both.");
    const n = Number(opts.id);
    if (!Number.isInteger(n) || n < 1)
      abort(`--id takes a design's number from \`velloo design list\`.`);
    if (!set || set.designs.length === 0) {
      // No manifest: the one design the convention finds is number 1.
      if (n === 1) return resolveDesign(undefined, cmd, { ...opts, id: undefined });
      abort(`there is no design #${n} here — \`velloo design list\` numbers them.`);
    }
    const entry = set.designs[n - 1];
    if (!entry)
      abort(
        `there is no design #${n} — ${designsLabel(set)} has ${set.designs.length}. \`velloo design list\` numbers them.`,
      );
    return designFolder(set, entry, abort);
  }

  if (arg) {
    const named = set && !arg.includes(sep) ? byName(set, arg, abort) : undefined;
    if (set && named) return designFolder(set, named, abort);
    const explicit = resolve(cwd, arg);
    if (await hasDesignConfig(explicit)) return explicit;
    // A velloo.json file, or the project directory holding one: its designs,
    // chosen the same way as running there with no arg.
    const project =
      basename(explicit) === "velloo.json" && existsSync(explicit) ? dirname(explicit) : explicit;
    const projectSet = await findDesigns(project).catch((err: unknown) =>
      abort((err as Error).message),
    );
    if (projectSet?.designs.length) return resolveDesign(undefined, cmd, { ...opts, cwd: project });
    // App root passed as a path — same as `cd` there with no arg.
    const nested = join(explicit, DEFAULT_FOLDER);
    if (await hasDesignConfig(nested)) return nested;
    // A bare name with no velloo.json here may name a design a project above
    // lists — say where, rather than reporting a folder that was never meant.
    if (!set && !arg.includes(sep)) {
      const above = await enclosingProject(cwd);
      const match = above?.designs.find((d) => d.name === arg);
      if (above && match) {
        abort(
          `design ${JSON.stringify(arg)} is listed in \`${shortPath(cwd, above.label)}\`, and commands only read the directory they run in. Run from \`${shortPath(cwd, above.dir)}\`, or pass its folder (\`${quoteArg(shortPath(cwd, match.root))}\`) instead of its name.`,
        );
      }
    }
    // A bare name that matches nothing is a typo'd design, not a folder path —
    // suggest the real names even for commands that require a config.
    if (set && !arg.includes(sep)) {
      abort(
        `unknown design ${JSON.stringify(arg)} — ${designsLabel(set)} lists: ${set.designs.map((d) => d.name).join(", ")}. Pass a design name or a folder path.`,
      );
    }
    if (opts.requireConfig) {
      abort(`${explicit} is not a velloo design folder (no .design/config.json).`);
    }
    return explicit;
  }

  if (set && set.designs.length > 0) {
    // Standing inside a design folder beats the manifest — you cd'd here.
    if (await hasDesignConfig(cwd)) return cwd;
    const picked = pickDesign(set, cwd);
    if (picked && picked.reason !== "arbitrary") return designFolder(set, picked.design, abort);
    const names = set.designs.map((d) => d.name);
    if (opts.interactive && process.stdin.isTTY) {
      const chosen = await select<string>({
        message: "Which design?",
        options: set.designs.map((d) => ({
          value: d.root,
          label: d.name,
          hint: relative(cwd, d.root),
        })),
      });
      if (isCancel(chosen)) abort("cancelled.");
      const design = set.designs.find((d) => d.root === chosen) as DesignEntry;
      return designFolder(set, design, abort);
    }
    // `velloo design` subcommands take --id; elsewhere, a name — quoted when
    // it needs to be, so the example runs as printed.
    const example = cmd.startsWith("design ")
      ? `velloo ${cmd} --id 1\` for ${quoteArg(names[0] ?? "")}, as numbered by \`velloo design list`
      : `velloo ${cmd} ${designExample(opts, names[0] ?? "")}`;
    abort(
      `${designsLabel(set)} lists several designs: ${names.join(", ")}. Pass one (e.g. \`${example}\`)${set.repo ? ` or set "defaultDesign"` : ""}.`,
    );
  }

  if (await hasDesignConfig(cwd)) return cwd;
  const here = join(cwd, DEFAULT_FOLDER);
  if (await hasDesignConfig(here)) return here;
  const takesDesign = opts.takesDesign !== false;
  const above = await enclosingProject(cwd);
  if (above) {
    // The design nearest to where the command ran makes the likeliest example.
    const nearest = [...above.designs].sort(
      (a, b) => relative(cwd, a.root).length - relative(cwd, b.root).length,
    )[0];
    const example =
      takesDesign && nearest
        ? `, or pass a design folder (e.g. \`velloo ${cmd} ${designExample(opts, relative(cwd, nearest.root))}\`)`
        : "";
    abort(
      `no velloo.json or design folder here. \`${shortPath(cwd, above.label)}\` lists ${above.designs.map((d) => JSON.stringify(d.name)).join(", ")}, and commands only read the directory they run in: run from \`${shortPath(cwd, above.dir)}\`${example}.`,
    );
  }
  const example = takesDesign
    ? `, pass a design folder or a velloo.json path (e.g. \`velloo ${cmd} ${designExample(opts, "apps/web")}\`)`
    : "";
  abort(
    `no velloo.json or design folder in ${cwd}. Run from the directory that has your velloo.json${example}, or \`velloo init\` here.${movedCheckoutHint(cwd)}`,
  );
}

/** A path as short as it can be read: relative to `cwd` when that is shorter. */
function shortPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel !== "" && rel.length < path.length ? rel : path;
}

/** How to pass `design` to a command, quoted to run as printed. */
function designExample(opts: ResolveDesignOptions, design: string): string {
  return opts.designFlag ? `${opts.designFlag}=${quoteArg(design)}` : quoteArg(design);
}

interface EnclosingProject {
  /** The directory whose velloo.json or local records hold the designs. */
  dir: string;
  /** How to name it in a message: its velloo.json path, or the directory. */
  label: string;
  designs: DesignEntry[];
}

/**
 * The nearest project above `cwd` that has designs. Never used to resolve a
 * design — a parent project is a different one — only to tell someone who ran
 * a command one directory too deep where their designs are, instead of
 * suggesting an `init` that would create a second, duplicate project.
 */
async function enclosingProject(cwd: string): Promise<EnclosingProject | null> {
  const here = resolve(cwd);
  for (let dir = dirname(here); dir !== here; ) {
    const set = await findDesigns(dir).catch(() => null);
    const designs = set?.designs.filter((d) => d.exists && !d.outsideRepo) ?? [];
    if (set && designs.length > 0) {
      return { dir, label: set.repo?.path ?? `${dir} (local designs)`, designs };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Every design a command run from `cwd` could mean: the checkout's usable
 * designs, else the one the `./velloo` convention finds, else none.
 */
export async function checkoutDesigns(cwd: string): Promise<string[]> {
  const set = await findDesigns(cwd).catch(() => null);
  if (set && set.designs.length > 0)
    return set.designs.filter((d) => d.exists && !d.outsideRepo).map((d) => d.root);
  try {
    return [
      await resolveDesign(undefined, "upgrade", {
        requireConfig: true,
        cwd,
        onFail: () => {
          throw new Error("no design here");
        },
      }),
    ];
  } catch {
    return [];
  }
}

/**
 * The design an agent session opens on. Unlike {@link resolveDesign}, a
 * checkout with several designs and nothing to pick between them doesn't fail:
 * an agent's MCP server that exits leaves it with no Velloo at all. It opens the
 * first by name and reports `arbitrary`, so the session can say so and switch.
 */
export async function resolveDesignForSession(
  arg: string | undefined,
  cmd: string,
  cwd = resolve("."),
): Promise<{ folder: string; pick: DesignPickReason | undefined }> {
  if (!arg && !(await hasDesignConfig(cwd))) {
    const set = await findDesigns(cwd).catch(() => null);
    const picked = set ? pickDesign(set, cwd) : null;
    if (set && picked?.reason === "arbitrary")
      return {
        folder: await designFolder(set, picked.design, (m) => fail(cmd, m)),
        pick: "arbitrary",
      };
  }
  return { folder: await resolveDesign(arg, cmd, { cwd }), pick: undefined };
}

/**
 * Local designs are keyed by their checkout's path, so moving the checkout
 * leaves them behind. When nothing resolved, name the ones that could belong
 * here: the design still exists, its checkout is gone, and this directory is
 * inside a project (a Git repository or a package) — an empty folder can't be
 * a moved checkout, and a leftover from an old experiment isn't worth a mention
 * there.
 */
function movedCheckoutHint(cwd: string): string {
  if (!insideProject(cwd)) return "";
  const orphans = listLocalDesigns().filter(
    (design) => !existsSync(design.root) && existsSync(design.designRoot),
  );
  if (orphans.length === 0) return "";
  const lines = orphans.map((design) => {
    const name = recordedDesignName(design.designRoot) ?? design.legacyName ?? design.id;
    return `\n  "${name}" at ${design.designRoot}, made for ${design.root}`;
  });
  return `\nThis machine has designs for checkouts that no longer exist at their old paths:${lines.join("")}\nIf this is one of those checkouts, moved, attach its design with \`velloo design bind <design folder>\`. Otherwise forget it with \`velloo design remove <design folder>\`.`;
}

function insideProject(cwd: string): boolean {
  const home = homedir();
  for (let dir = cwd; dir !== home && dirname(dir) !== dir; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, "package.json"))) return true;
  }
  return false;
}

export interface ScreenEntry {
  id: string;
  name: string;
  path: string;
}

/** Every screen under `<folder>/screens`, sorted; skips unparseable files. */
async function listScreens(folder: string): Promise<ScreenEntry[]> {
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
async function listBoards(folder: string): Promise<BoardEntry[]> {
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
function boardsByScreen(boards: BoardEntry[]): Map<string, string[]> {
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
