import { join } from "node:path";
import { type Page, PageSchema, type Theme, ThemeSchema } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { pushHistory } from "../history.ts";

/** Schema-validate then write a page; update the in-memory cache. */
export async function persistPage(folder: DesignFolder, pageId: string, page: Page): Promise<Page> {
  const validated = PageSchema.parse(page);
  const prev = folder.pages.get(pageId);
  if (prev) pushHistory({ kind: "page", pageId, page: prev });
  await writeJsonAtomic(join(folder.root, "pages", `${pageId}.json`), validated);
  folder.pages.set(pageId, validated);
  return validated;
}

/** Schema-validate then write the theme; update the in-memory cache. */
export async function persistTheme(folder: DesignFolder, theme: Theme): Promise<Theme> {
  const validated = ThemeSchema.parse(theme);
  const prev = folder.theme;
  if (prev) pushHistory({ kind: "theme", theme: prev });
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), validated);
  folder.theme = validated;
  return validated;
}
