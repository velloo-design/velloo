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
  board: Board;
  snippets: Map<string, Snippet>;
  /** Per-screen annotation arrays. Empty array for screens with no sidecar. */
  annotations: Map<string, Annotation[]>;
  /** Board-level free notes (single flat array). */
  notes: CanvasNote[];
}

/** Screen id is the filename stem (e.g. "landing" for screens/landing.json). */
export function screenIdFromFilename(filename: string): string {
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

/**
 * Load per-screen annotation sidecars: `screens/<screenId>.annotations.json`.
 * Board-level notes load separately from `board.notes.json` at the folder root.
 */
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

async function loadBoardNotes(root: string): Promise<CanvasNote[]> {
  const raw = await readJsonOrNull<unknown>(join(root, "board.notes.json"));
  if (raw === null) return [];
  return (raw as unknown[]).map((r) => CanvasNoteSchema.parse(r));
}

async function loadBoard(root: string): Promise<Board> {
  const raw = await readJsonOrNull<unknown>(join(root, "board.json"));
  if (raw === null) return { frames: [], groups: [] };
  return BoardSchema.parse(raw);
}

/** Predicate: accepts `<id>.json` but rejects `<id>.annotations.json` etc. */
function isPlainScreenJson(file: string): boolean {
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
    isPlainScreenJson,
  );
  const snippets = await loadDir(
    join(root, "snippets"),
    (raw) => SnippetSchema.parse(raw),
    snippetIdFromFilename,
  );
  const board = await loadBoard(root);
  const annotations = await loadAnnotations(root, screens.keys());
  const notes = await loadBoardNotes(root);

  return { root, config, theme, screens, board, snippets, annotations, notes };
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

/** Reload the board.json from disk. */
export async function reloadBoard(folder: DesignFolder): Promise<Board> {
  const board = await loadBoard(folder.root);
  folder.board = board;
  return board;
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

/** Reload board-level notes from `board.notes.json`. */
export async function reloadNotes(folder: DesignFolder): Promise<CanvasNote[]> {
  const notes = await loadBoardNotes(folder.root);
  folder.notes = notes;
  return notes;
}
