import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  type Annotation,
  AnnotationSchema,
  type Board,
  BoardSchema,
  type CanvasNote,
  CanvasNoteSchema,
  type Config,
  ConfigSchema,
  CURRENT_SCHEMA_VERSION,
  isArchived,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  schemaVersionOf,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import { HistoryManager } from "./history.ts";
import { readRepoFeedback } from "./repo-config.ts";

export interface DesignFolder {
  root: string;
  config: Config;
  theme: Theme;
  /** Per-folder undo/redo stacks — see history.ts. */
  history: HistoryManager;
  /**
   * Contents of `theme/custom.css` — the folder's escape-hatch CSS for
   * keyframes, textures, clip-paths. Empty string when the file is
   * absent. Injected into every rendered document after the theme vars.
   */
  customCss: string;
  /**
   * Every named theme in `theme/*.json`, keyed by filename stem.
   * Always contains "default" (=== `theme`). Boards pick one via
   * `board.theme`; renders fall back to the default.
   */
  themes: Map<string, Theme>;
  screens: Map<string, Screen>;
  /**
   * Boards keyed by id. A folder has many boards — one per flow ("welcome",
   * "components", "settings", etc.). Each board has its own frames + groups.
   */
  boards: Map<string, Board>;
  snippets: Map<string, Snippet>;
  /** Per-screen annotation arrays. Empty array for screens with no sidecar. */
  annotations: Map<string, Annotation[]>;
  /** Per-board free notes. Notes live in board coords, so they're scoped per board. */
  notes: Map<string, CanvasNote[]>;
}

/** Screen id is the filename stem (e.g. "landing" for screens/landing.json). */
export function screenIdFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

export function boardIdFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

/** Snippet id is the filename stem (same convention). */
export function snippetIdFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function loadDir<T>(
  dir: string,
  parse: (raw: unknown) => T,
  idFromFile: (file: string) => string,
  predicate?: (file: string) => boolean,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  // Sort so the canvas sidebar displays boards/screens/snippets in a
  // deterministic order across machines and `readdir` implementations.
  // Alphabetical by filename matches what users see in the filesystem.
  entries.sort((a, b) => a.localeCompare(b));
  for (const file of entries) {
    if (extname(file) !== ".json") continue;
    if (predicate && !predicate(file)) continue;
    const raw = await readJson(join(dir, file));
    out.set(idFromFile(file), parse(raw));
  }
  return out;
}

async function loadAnnotations(
  root: string,
  screenIds: Iterable<string>,
): Promise<Map<string, Annotation[]>> {
  const annotations = new Map<string, Annotation[]>();
  for (const screenId of screenIds) {
    const raw = await readJsonOrNull<unknown>(
      join(root, "screens", `${screenId}.annotations.json`),
    );
    annotations.set(
      screenId,
      raw === null ? [] : (raw as unknown[]).map((r) => AnnotationSchema.parse(r)),
    );
  }
  return annotations;
}

/**
 * Load board-level notes. Each board can have its own free notes file at
 * `boards/<id>.notes.json`. Returns a map keyed by boardId.
 */
async function loadBoardNotes(
  root: string,
  boardIds: Iterable<string>,
): Promise<Map<string, CanvasNote[]>> {
  const notes = new Map<string, CanvasNote[]>();
  for (const boardId of boardIds) {
    const raw = await readJsonOrNull<unknown>(join(root, "boards", `${boardId}.notes.json`));
    notes.set(
      boardId,
      raw === null ? [] : (raw as unknown[]).map((r) => CanvasNoteSchema.parse(r)),
    );
  }
  return notes;
}

/** Predicate: accepts `<id>.json` but rejects `<id>.annotations.json` etc. */
function isPlainJson(file: string): boolean {
  const stem = basename(file, ".json");
  return !stem.includes(".");
}

export async function loadDesignFolder(folder: string): Promise<DesignFolder> {
  const root = resolve(folder);
  const configRaw = await readJson(join(root, ".design", "config.json"));
  const themeRaw = await readJson(join(root, "theme", "default.json"));
  // Format-version gate, BEFORE schema validation so the user gets a
  // versioning message rather than a wall of zod issues.
  const version = schemaVersionOf(configRaw);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `velloo: ${root} uses design-folder schema version ${version}, but this velloo ` +
        `only knows version ${CURRENT_SCHEMA_VERSION}. Upgrade velloo to open it.`,
    );
  }
  if (version < CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `velloo: ${root} uses design-folder schema version ${version} ` +
        `(current: ${CURRENT_SCHEMA_VERSION}). Run \`velloo upgrade\` to migrate it.`,
    );
  }
  const parsedConfig = ConfigSchema.parse(configRaw);
  // Feedback consent lives at the repo root; overlaying it here means every
  // reader keeps asking `config.feedback` and none of them cares where it was
  // stored. A folder outside a registered repo (or written before the move)
  // falls back to its own recorded answer.
  const repoFeedback = await readRepoFeedback(root);
  const config = repoFeedback ? { ...parsedConfig, feedback: repoFeedback } : parsedConfig;
  const theme = ThemeSchema.parse(themeRaw);

  const screens = await loadDir(
    join(root, "screens"),
    (raw) => ScreenSchema.parse(raw),
    screenIdFromFilename,
    isPlainJson,
  );
  const snippets = await loadDir(
    join(root, "snippets"),
    (raw) => SnippetSchema.parse(raw),
    snippetIdFromFilename,
  );
  const boards = await loadDir(
    join(root, "boards"),
    (raw) => BoardSchema.parse(raw),
    boardIdFromFilename,
    isPlainJson,
  );
  const annotations = await loadAnnotations(root, screens.keys());
  const notes = await loadBoardNotes(root, boards.keys());
  const customCss = await readCustomCss(root);
  const themes = await loadDir(
    join(root, "theme"),
    (raw) => ThemeSchema.parse(raw),
    snippetIdFromFilename,
  );
  themes.set("default", theme);

  return {
    root,
    config,
    theme,
    history: new HistoryManager(),
    customCss,
    themes,
    screens,
    boards,
    snippets,
    annotations,
    notes,
  };
}

/**
 * Re-read the entire folder from disk into the existing DesignFolder object
 * (in place, so every closure holding the reference sees the fresh state).
 * Used after out-of-band rewrites — git revert-all — where per-file reloads
 * can't know what changed. The HistoryManager instance is kept; callers
 * decide whether to clear it.
 */
export async function reloadDesignFolder(folder: DesignFolder): Promise<void> {
  const fresh = await loadDesignFolder(folder.root);
  folder.config = fresh.config;
  folder.theme = fresh.theme;
  folder.customCss = fresh.customCss;
  folder.themes = fresh.themes;
  folder.screens = fresh.screens;
  folder.boards = fresh.boards;
  folder.snippets = fresh.snippets;
  folder.annotations = fresh.annotations;
  folder.notes = fresh.notes;
}

/**
 * Board `[id, board]` entries in display order: ids listed in
 * `config.boardOrder` first (in that sequence), then any remaining boards
 * in their loaded (filename) order. Stale ids in `boardOrder` — boards
 * that have since been deleted — are skipped. Absent/empty `boardOrder`
 * ⇒ the plain filename order.
 */
export function orderedBoards(folder: DesignFolder): [string, Board][] {
  const order = folder.config.boardOrder;
  if (!order || order.length === 0) return [...folder.boards.entries()];
  const seen = new Set<string>();
  const out: [string, Board][] = [];
  for (const id of order) {
    const board = folder.boards.get(id);
    if (board && !seen.has(id)) {
      out.push([id, board]);
      seen.add(id);
    }
  }
  for (const [id, board] of folder.boards) {
    if (!seen.has(id)) out.push([id, board]);
  }
  return out;
}

/**
 * The boards a user should *see*: {@link orderedBoards} minus archived ones.
 *
 * Deliberately a separate function rather than a filtering default inside
 * `orderedBoards` — presentation call sites opt in by name, so a future scan
 * that must see every board (frame pruning, theme usage) can't inherit the
 * filter by accident and silently skip one.
 */
export function activeBoards(folder: DesignFolder): [string, Board][] {
  return orderedBoards(folder).filter(([, board]) => !isArchived(board));
}

/** Reload one screen from disk and update the cache in place. */
export async function reloadScreen(folder: DesignFolder, screenId: string): Promise<Screen | null> {
  const path = join(folder.root, "screens", `${screenId}.json`);
  try {
    const raw = await readJson(path);
    const screen = ScreenSchema.parse(raw);
    folder.screens.set(screenId, screen);
    return screen;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      folder.screens.delete(screenId);
      folder.annotations.delete(screenId);
      return null;
    }
    throw err;
  }
}

/** Reload one board from disk and update the cache in place. */
export async function reloadBoard(folder: DesignFolder, boardId: string): Promise<Board | null> {
  const path = join(folder.root, "boards", `${boardId}.json`);
  try {
    const raw = await readJson(path);
    const board = BoardSchema.parse(raw);
    folder.boards.set(boardId, board);
    return board;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      folder.boards.delete(boardId);
      folder.notes.delete(boardId);
      return null;
    }
    throw err;
  }
}

export async function reloadTheme(folder: DesignFolder): Promise<Theme> {
  const raw = await readJson(join(folder.root, "theme", "default.json"));
  const theme = ThemeSchema.parse(raw);
  folder.theme = theme;
  folder.customCss = await readCustomCss(folder.root);
  folder.themes = await loadDir(
    join(folder.root, "theme"),
    (r) => ThemeSchema.parse(r),
    snippetIdFromFilename,
  );
  folder.themes.set("default", theme);
  return theme;
}

/** Resolve a named theme; absent/unknown names fall back to the default. */
export function themeByName(folder: DesignFolder, name?: string | null): Theme {
  if (!name) return folder.theme;
  return folder.themes.get(name) ?? folder.theme;
}

/**
 * Strict theme resolution for the MCP boundary: an unknown *named* theme is an
 * error (listing the known names) rather than a silent fall-back to the default
 * — a typo'd `theme:"brnad"` otherwise yields a default-theme capture the agent
 * trusts as the named one. An omitted name still resolves to the default.
 */
export function resolveNamedTheme(
  folder: DesignFolder,
  name: string | undefined,
): { ok: true; theme: Theme } | { ok: false; message: string } {
  if (!name) return { ok: true, theme: folder.theme };
  const theme = folder.themes.get(name);
  if (theme) return { ok: true, theme };
  const known = [...folder.themes.keys()].join(", ") || "(none)";
  return { ok: false, message: `Unknown theme "${name}". Known themes: ${known}.` };
}

/**
 * Effective theme name for a screen when the caller passes none: what the
 * canvas itself renders — the hosting board's pin, unpinned boards counting
 * as "default". Themes attach to boards (the viewing context), never to
 * screens or frames, so this is the only screen→theme inference there is.
 * Boards disagreeing is an error rather than a guess: a capture silently
 * mistinted relative to the canvas is exactly what this resolution prevents.
 */
export function pinnedThemeForScreen(
  folder: DesignFolder,
  screenId: string,
): { ok: true; name: string | undefined } | { ok: false; message: string } {
  const boardsByTheme = new Map<string, string[]>();
  for (const board of folder.boards.values()) {
    // An archived board's theme pin must not enter the disagreement check —
    // a parked candidate board would otherwise wedge every screenshot of a
    // screen it happens to share with a live board.
    if (isArchived(board)) continue;
    if (!board.frames.some((f) => f.screen === screenId)) continue;
    const name = board.theme ?? "default";
    const hosts = boardsByTheme.get(name) ?? [];
    hosts.push(board.id);
    boardsByTheme.set(name, hosts);
  }
  if (boardsByTheme.size === 0) return { ok: true, name: undefined };
  if (boardsByTheme.size === 1) {
    const [only] = boardsByTheme.keys();
    return { ok: true, name: only === "default" ? undefined : only };
  }
  const list = [...boardsByTheme.entries()]
    .map(([name, hosts]) => `"${name}" (${hosts.join(", ")})`)
    .join(", ");
  return {
    ok: false,
    message: `Screen "${screenId}" is hosted by boards with different themes: ${list}. Pass theme: to pick the one to render.`,
  };
}

async function readCustomCss(root: string): Promise<string> {
  try {
    return await readFile(join(root, "theme", "custom.css"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Reload one snippet from disk and update the cache in place. */
export async function reloadSnippet(
  folder: DesignFolder,
  snippetId: string,
): Promise<Snippet | null> {
  const path = join(folder.root, "snippets", `${snippetId}.json`);
  try {
    const raw = await readJson(path);
    const snippet = SnippetSchema.parse(raw);
    folder.snippets.set(snippetId, snippet);
    return snippet;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      folder.snippets.delete(snippetId);
      return null;
    }
    throw err;
  }
}

/** Reload a screen's annotations sidecar. */
export async function reloadAnnotations(
  folder: DesignFolder,
  screenId: string,
): Promise<Annotation[]> {
  const raw = await readJsonOrNull<unknown>(
    join(folder.root, "screens", `${screenId}.annotations.json`),
  );
  const parsed = raw === null ? [] : (raw as unknown[]).map((r) => AnnotationSchema.parse(r));
  folder.annotations.set(screenId, parsed);
  return parsed;
}

/** Reload notes for one board. */
export async function reloadNotes(folder: DesignFolder, boardId: string): Promise<CanvasNote[]> {
  const raw = await readJsonOrNull<unknown>(join(folder.root, "boards", `${boardId}.notes.json`));
  const parsed = raw === null ? [] : (raw as unknown[]).map((r) => CanvasNoteSchema.parse(r));
  folder.notes.set(boardId, parsed);
  return parsed;
}
