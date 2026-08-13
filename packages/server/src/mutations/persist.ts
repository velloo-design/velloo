import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $, DoAsync, type Result } from "@velloo/result";
import {
  type Annotation,
  AnnotationSchema,
  type Board,
  BoardSchema,
  type CanvasNote,
  CanvasNoteSchema,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { pushHistory } from "../history.ts";
import type { MutationError } from "./errors.ts";
import { validateScreenIds } from "./validate-ids.ts";

/** Schema-validate then write a screen; update the in-memory cache. */
export async function persistScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
): Promise<Screen> {
  const validated = ScreenSchema.parse(screen);
  const prev = folder.screens.get(screenId) ?? null;
  pushHistory({ kind: "screen", screenId, screen: prev });
  await writeJsonAtomic(join(folder.root, "screens", `${screenId}.json`), validated);
  folder.screens.set(screenId, validated);
  return validated;
}

/**
 * The "right" way to land a screen write in mutation code: validates `$id`
 * uniqueness, then schema-validates + persists.
 */
export function commitScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
): Promise<Result<Screen, MutationError>> {
  return DoAsync<Screen, MutationError>(async function* () {
    yield* $(validateScreenIds(screenId, screen));
    return await persistScreen(folder, screenId, screen);
  });
}

/** Delete a screen from disk + cache. Pushes history so the deletion is undoable. */
export async function deletePersistedScreen(
  folder: DesignFolder,
  screenId: string,
): Promise<void> {
  const prev = folder.screens.get(screenId) ?? null;
  pushHistory({ kind: "screen", screenId, screen: prev });
  await rm(join(folder.root, "screens", `${screenId}.json`), { force: true });
  await rm(join(folder.root, "screens", `${screenId}.annotations.json`), { force: true });
  folder.screens.delete(screenId);
  folder.annotations.delete(screenId);
}

/** Schema-validate then write the board; update the in-memory cache. */
export async function persistBoard(folder: DesignFolder, board: Board): Promise<Board> {
  const validated = BoardSchema.parse(board);
  pushHistory({ kind: "board", board: folder.board });
  await writeJsonAtomic(join(folder.root, "board.json"), validated);
  folder.board = validated;
  return validated;
}

/** Schema-validate then write the theme; update the in-memory cache. */
export async function persistTheme(folder: DesignFolder, theme: Theme): Promise<Theme> {
  const validated = ThemeSchema.parse(theme);
  pushHistory({ kind: "theme", theme: folder.theme });
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

/** Delete a snippet from disk + cache. */
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
 * Persist a screen's annotations sidecar. Removing the file when the array
 * empties keeps the working directory clean.
 */
export async function persistAnnotations(
  folder: DesignFolder,
  screenId: string,
  annotations: Annotation[],
): Promise<Annotation[]> {
  const validated = annotations.map((a) => AnnotationSchema.parse(a));
  const path = join(folder.root, "screens", `${screenId}.annotations.json`);
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.annotations.set(screenId, validated);
  return validated;
}

/** Persist board-level free notes — empty array deletes `board.notes.json`. */
export async function persistCanvasNotes(
  folder: DesignFolder,
  notes: CanvasNote[],
): Promise<CanvasNote[]> {
  const validated = notes.map((n) => CanvasNoteSchema.parse(n));
  const path = join(folder.root, "board.notes.json");
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.notes = validated;
  return validated;
}
