import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $, DoAsync, type Result } from "@velloo/result";
import {
  type Annotation,
  AnnotationSchema,
  type CanvasNote,
  CanvasNoteSchema,
  type Page,
  PageSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { pushHistory } from "../history.ts";
import type { MutationError } from "./errors.ts";
import { validatePageIds } from "./validate-ids.ts";

/** Schema-validate then write a page; update the in-memory cache. */
export async function persistPage(folder: DesignFolder, pageId: string, page: Page): Promise<Page> {
  const validated = PageSchema.parse(page);
  const prev = folder.pages.get(pageId);
  if (prev) pushHistory({ kind: "page", pageId, page: prev });
  await writeJsonAtomic(join(folder.root, "pages", `${pageId}.json`), validated);
  folder.pages.set(pageId, validated);
  return validated;
}

/**
 * The "right" way to land a page write in mutation code: validates per-variant
 * `$id` uniqueness, then schema-validates + persists. Returns a Result so the
 * id-conflict error flows through the standard MutationError channel rather
 * than throwing. Schema-validation failures still throw (they're real bugs in
 * mutation code, not recoverable agent errors).
 */
export function commitPage(
  folder: DesignFolder,
  pageId: string,
  page: Page,
): Promise<Result<Page, MutationError>> {
  return DoAsync<Page, MutationError>(async function* () {
    yield* $(validatePageIds(pageId, page));
    return await persistPage(folder, pageId, page);
  });
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

/** Schema-validate then write a snippet; update the in-memory cache. */
export async function persistSnippet(
  folder: DesignFolder,
  snippetId: string,
  snippet: Snippet,
): Promise<Snippet> {
  const validated = SnippetSchema.parse(snippet);
  const prev = folder.snippets.get(snippetId) ?? null;
  pushHistory({ kind: "snippet", snippetId, snippet: prev });
  await writeJsonAtomic(join(folder.root, "snippets", `${snippetId}.json`), validated);
  folder.snippets.set(snippetId, validated);
  return validated;
}

/** Delete a snippet from disk + cache. Pushes history so the deletion is undoable. */
export async function deletePersistedSnippet(
  folder: DesignFolder,
  snippetId: string,
): Promise<void> {
  const prev = folder.snippets.get(snippetId);
  if (prev) pushHistory({ kind: "snippet", snippetId, snippet: prev });
  await rm(join(folder.root, "snippets", `${snippetId}.json`), { force: true });
  folder.snippets.delete(snippetId);
}

/**
 * Persist a page's annotations sidecar — validates each entry, writes the
 * array, updates the in-memory cache. Removing the file when the array
 * empties keeps the working directory clean.
 */
export async function persistAnnotations(
  folder: DesignFolder,
  pageId: string,
  annotations: Annotation[],
): Promise<Annotation[]> {
  const validated = annotations.map((a) => AnnotationSchema.parse(a));
  const path = join(folder.root, "pages", `${pageId}.annotations.json`);
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.annotations.set(pageId, validated);
  return validated;
}

/** Same shape for canvas notes — empty array deletes the sidecar. */
export async function persistCanvasNotes(
  folder: DesignFolder,
  pageId: string,
  notes: CanvasNote[],
): Promise<CanvasNote[]> {
  const validated = notes.map((n) => CanvasNoteSchema.parse(n));
  const path = join(folder.root, "pages", `${pageId}.notes.json`);
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.notes.set(pageId, validated);
  return validated;
}
