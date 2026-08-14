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
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";

export interface DesignFolder {
  root: string;
  config: Config;
  theme: Theme;
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
  const config = ConfigSchema.parse(configRaw);
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

  return { root, config, theme, screens, boards, snippets, annotations, notes };
}

/** Reload one screen from disk and update the cache in place. */
export async function reloadScreen(
  folder: DesignFolder,
  screenId: string,
): Promise<Screen | null> {
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
export async function reloadBoard(
  folder: DesignFolder,
  boardId: string,
): Promise<Board | null> {
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
  return theme;
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
export async function reloadNotes(
  folder: DesignFolder,
  boardId: string,
): Promise<CanvasNote[]> {
  const raw = await readJsonOrNull<unknown>(
    join(folder.root, "boards", `${boardId}.notes.json`),
  );
  const parsed = raw === null ? [] : (raw as unknown[]).map((r) => CanvasNoteSchema.parse(r));
  folder.notes.set(boardId, parsed);
  return parsed;
}
