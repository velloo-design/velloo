import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  type Config,
  ConfigSchema,
  type Page,
  PageSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";

export interface DesignFolder {
  root: string;
  config: Config;
  theme: Theme;
  pages: Map<string, Page>;
}

/** Page id is the filename stem (e.g. "onboarding" for pages/onboarding.json). */
export function pageIdFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function loadDesignFolder(folder: string): Promise<DesignFolder> {
  const root = resolve(folder);
  const configRaw = await readJson(join(root, ".design", "config.json"));
  const themeRaw = await readJson(join(root, "theme", "default.json"));
  const config = ConfigSchema.parse(configRaw);
  const theme = ThemeSchema.parse(themeRaw);

  const pagesDir = join(root, "pages");
  const entries = await readdir(pagesDir);
  const pages = new Map<string, Page>();
  for (const file of entries) {
    if (extname(file) !== ".json") continue;
    const id = pageIdFromFilename(file);
    const raw = await readJson(join(pagesDir, file));
    pages.set(id, PageSchema.parse(raw));
  }

  return { root, config, theme, pages };
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
