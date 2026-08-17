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
  type Config,
  ConfigSchema,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import type { MutationError } from "./errors.ts";
import { snippetNotFound } from "./errors.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";
import { validateScreenIds } from "./validate-ids.ts";

/** Schema-validate then write a screen; update the in-memory cache. */
export async function persistScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
): Promise<Screen> {
  const validated = ScreenSchema.parse(screen);
  const prev = folder.screens.get(screenId) ?? null;
  folder.history.push({ kind: "screen", screenId, screen: prev });
  await writeJsonAtomic(join(folder.root, "screens", `${screenId}.json`), validated);
  folder.screens.set(screenId, validated);
  return validated;
}

export function commitScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
): Promise<Result<Screen, MutationError>> {
  return DoAsync<Screen, MutationError>(async function* () {
    yield* $(validateScreenIds(screenId, screen));
    // Virtualized snippet body: persist the tree back to the snippet
    // file (keeping name + params intact) and return a synthetic Screen
    // shape so callers don't have to special-case.
    if (isSnippetTreeId(screenId)) {
      const snippetId = snippetIdFromTreeId(screenId);
      const prev = folder.snippets.get(snippetId);
      if (!prev) {
        return yield* $({ ok: false, error: snippetNotFound(snippetId) });
      }
      const updated = await persistSnippet(folder, snippetId, { ...prev, tree: screen.tree });
      return { id: screenId, name: updated.name, tree: updated.tree };
    }
    return await persistScreen(folder, screenId, screen);
  });
}

export async function deletePersistedScreen(folder: DesignFolder, screenId: string): Promise<void> {
  const prev = folder.screens.get(screenId) ?? null;
  folder.history.push({ kind: "screen", screenId, screen: prev });
  await rm(join(folder.root, "screens", `${screenId}.json`), { force: true });
  await rm(join(folder.root, "screens", `${screenId}.annotations.json`), { force: true });
  folder.screens.delete(screenId);
  folder.annotations.delete(screenId);
}

/** Schema-validate then write a board; update the in-memory cache. */
export async function persistBoard(
  folder: DesignFolder,
  boardId: string,
  board: Board,
): Promise<Board> {
  const validated = BoardSchema.parse(board);
  const prev = folder.boards.get(boardId) ?? null;
  folder.history.push({ kind: "board", boardId, board: prev });
  await writeJsonAtomic(join(folder.root, "boards", `${boardId}.json`), validated);
  folder.boards.set(boardId, validated);
  return validated;
}

export async function deletePersistedBoard(folder: DesignFolder, boardId: string): Promise<void> {
  const prev = folder.boards.get(boardId) ?? null;
  folder.history.push({ kind: "board", boardId, board: prev });
  await rm(join(folder.root, "boards", `${boardId}.json`), { force: true });
  await rm(join(folder.root, "boards", `${boardId}.notes.json`), { force: true });
  folder.boards.delete(boardId);
  folder.notes.delete(boardId);
}

export async function persistTheme(folder: DesignFolder, theme: Theme): Promise<Theme> {
  const validated = ThemeSchema.parse(theme);
  folder.history.push({ kind: "theme", theme: folder.theme });
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), validated);
  folder.theme = validated;
  folder.themes.set("default", validated);
  return validated;
}

/**
 * Persist a named theme (`theme/<name>.json`). "default" routes through
 * persistTheme so undo history keeps covering the primary theme; named
 * themes skip history (board-scoped looks, edited deliberately).
 */
export async function persistNamedTheme(
  folder: DesignFolder,
  name: string,
  theme: Theme,
): Promise<Theme> {
  if (name === "default") return persistTheme(folder, theme);
  const validated = ThemeSchema.parse(theme);
  await writeJsonAtomic(join(folder.root, "theme", `${name}.json`), validated);
  folder.themes.set(name, validated);
  return validated;
}

export async function persistSnippet(
  folder: DesignFolder,
  snippetId: string,
  snippet: Snippet,
): Promise<Snippet> {
  const validated = SnippetSchema.parse(snippet);
  const prev = folder.snippets.get(snippetId) ?? null;
  folder.history.push({ kind: "snippet", snippetId, snippet: prev });
  await writeJsonAtomic(join(folder.root, "snippets", `${snippetId}.json`), validated);
  folder.snippets.set(snippetId, validated);
  return validated;
}

export async function deletePersistedSnippet(
  folder: DesignFolder,
  snippetId: string,
): Promise<void> {
  const prev = folder.snippets.get(snippetId);
  if (prev) folder.history.push({ kind: "snippet", snippetId, snippet: prev });
  await rm(join(folder.root, "snippets", `${snippetId}.json`), { force: true });
  folder.snippets.delete(snippetId);
}

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

/**
 * Persist `.design/config.json` and refresh the in-memory cache. Used
 * by the Sprint-Y extension mutations (`add_extension`,
 * `update_extension`, `remove_extension`). Validates the full config
 * against the schema first so a malformed write can't leave a folder
 * unloadable.
 */
export async function persistConfig(folder: DesignFolder, config: Config): Promise<Config> {
  const validated = ConfigSchema.parse(config);
  await writeJsonAtomic(join(folder.root, ".design", "config.json"), validated);
  folder.config = validated;
  return validated;
}

/** Persist a board's free notes. Empty array deletes the sidecar file. */
export async function persistCanvasNotes(
  folder: DesignFolder,
  boardId: string,
  notes: CanvasNote[],
): Promise<CanvasNote[]> {
  const validated = notes.map((n) => CanvasNoteSchema.parse(n));
  const path = join(folder.root, "boards", `${boardId}.notes.json`);
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.notes.set(boardId, validated);
  return validated;
}
