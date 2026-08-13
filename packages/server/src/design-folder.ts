import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  type Annotation,
  AnnotationSchema,
  type CanvasNote,
  CanvasNoteSchema,
  type Config,
  ConfigSchema,
  type Page,
  PageSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";

export interface DesignFolder {
  root: string;
  config: Config;
  theme: Theme;
  pages: Map<string, Page>;
  snippets: Map<string, Snippet>;
  /** Per-page annotation arrays. Empty array for pages with no sidecar. */
  annotations: Map<string, Annotation[]>;
  /** Per-page free canvas notes. */
  notes: Map<string, CanvasNote[]>;
}

/** Page id is the filename stem (e.g. "onboarding" for pages/onboarding.json). */
export function pageIdFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

/** Snippet id is the filename stem (same convention as pages). */
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
    const raw = await readJson(join(dir, file));
    out.set(idFromFile(file), parse(raw));
  }
  return out;
}

/**
 * Load per-page sidecar files for annotations + canvas notes. Each sidecar
 * is `pages/<pageId>.annotations.json` or `.notes.json` — an array of the
 * matching shape, or absent (treated as empty).
 */
async function loadSidecars(
  root: string,
  pageIds: Iterable<string>,
): Promise<{
  annotations: Map<string, Annotation[]>;
  notes: Map<string, CanvasNote[]>;
}> {
  const annotations = new Map<string, Annotation[]>();
  const notes = new Map<string, CanvasNote[]>();
  for (const pageId of pageIds) {
    const annRaw = await readJsonOrNull<unknown>(join(root, "pages", `${pageId}.annotations.json`));
    annotations.set(
      pageId,
      annRaw === null ? [] : (annRaw as unknown[]).map((r) => AnnotationSchema.parse(r)),
    );
    const notesRaw = await readJsonOrNull<unknown>(join(root, "pages", `${pageId}.notes.json`));
    notes.set(
      pageId,
      notesRaw === null ? [] : (notesRaw as unknown[]).map((r) => CanvasNoteSchema.parse(r)),
    );
  }
  return { annotations, notes };
}

export async function loadDesignFolder(folder: string): Promise<DesignFolder> {
  const root = resolve(folder);
  const configRaw = await readJson(join(root, ".design", "config.json"));
  const themeRaw = await readJson(join(root, "theme", "default.json"));
  const config = ConfigSchema.parse(configRaw);
  const theme = ThemeSchema.parse(themeRaw);

  const pages = await loadDir(
    join(root, "pages"),
    (raw) => PageSchema.parse(raw),
    pageIdFromFilename,
  );
  const snippets = await loadDir(
    join(root, "snippets"),
    (raw) => SnippetSchema.parse(raw),
    snippetIdFromFilename,
  );
  const { annotations, notes } = await loadSidecars(root, pages.keys());

  return { root, config, theme, pages, snippets, annotations, notes };
}

/** Reload one page from disk and update the cache in place. */
export async function reloadPage(folder: DesignFolder, pageId: string): Promise<Page | null> {
  const path = join(folder.root, "pages", `${pageId}.json`);
  try {
    const raw = await readJson(path);
    const page = PageSchema.parse(raw);
    folder.pages.set(pageId, page);
    return page;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      folder.pages.delete(pageId);
      // A page removal cascades to its sidecars — the in-memory state
      // shouldn't keep stale annotations attached to a vanished page.
      folder.annotations.delete(pageId);
      folder.notes.delete(pageId);
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

/** Reload a page's annotations sidecar. */
export async function reloadAnnotations(
  folder: DesignFolder,
  pageId: string,
): Promise<Annotation[]> {
  const raw = await readJsonOrNull<unknown>(
    join(folder.root, "pages", `${pageId}.annotations.json`),
  );
  const parsed = raw === null ? [] : (raw as unknown[]).map((r) => AnnotationSchema.parse(r));
  folder.annotations.set(pageId, parsed);
  return parsed;
}

/** Reload a page's notes sidecar. */
export async function reloadNotes(folder: DesignFolder, pageId: string): Promise<CanvasNote[]> {
  const raw = await readJsonOrNull<unknown>(join(folder.root, "pages", `${pageId}.notes.json`));
  const parsed = raw === null ? [] : (raw as unknown[]).map((r) => CanvasNoteSchema.parse(r));
  folder.notes.set(pageId, parsed);
  return parsed;
}
