import { join } from "node:path";
import { type Page, PageSchema, type Theme, ThemeSchema } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";

/** Schema-validate then write a page; update the in-memory cache. */
export async function persistPage(folder: DesignFolder, pageId: string, page: Page): Promise<Page> {
  const validated = PageSchema.parse(page);
  await writeJsonAtomic(join(folder.root, "pages", `${pageId}.json`), validated);
  folder.pages.set(pageId, validated);
  return validated;
}

/** Schema-validate then write the theme; update the in-memory cache. */
export async function persistTheme(folder: DesignFolder, theme: Theme): Promise<Theme> {
  const validated = ThemeSchema.parse(theme);
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), validated);
  folder.theme = validated;
  return validated;
}
