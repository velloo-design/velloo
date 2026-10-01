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
import { isAgentWrite } from "../activity.ts";
import { type DesignFolder, withBootBound } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { fingerprint, type HistoryEntry } from "../history.ts";
import type { MutationError } from "./errors.ts";
import { snippetNotFound } from "./errors.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";
import { validateScreenIds } from "./validate-ids.ts";

/**
 * Put a write on the canvas's undo stack, unless an agent made it: undo is the
 * person's, and reverting an agent's change is a conversation with the agent,
 * not a keystroke. `next` is the state the write leaves behind.
 */
function recordHistory(folder: DesignFolder, entry: HistoryEntry, next: unknown): void {
  if (isAgentWrite()) return;
  folder.history.push({ ...entry, after: fingerprint(next) });
}

/** Schema-validate then write a screen; update the in-memory cache. */
export async function persistScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
  coalesceKey?: string,
): Promise<Screen> {
  const validated = ScreenSchema.parse(screen);
  const prev = folder.screens.get(screenId) ?? null;
  recordHistory(folder, { kind: "screen", screenId, screen: prev, coalesceKey }, validated);
  await writeJsonAtomic(join(folder.root, "screens", `${screenId}.json`), validated);
  folder.screens.set(screenId, validated);
  return validated;
}

export function commitScreen(
  folder: DesignFolder,
  screenId: string,
  screen: Screen,
  /** Names the gesture this write belongs to, so a whole drag is one undo step. */
  coalesceKey?: string,
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
      const updated = await persistSnippet(
        folder,
        snippetId,
        { ...prev, tree: screen.tree },
        coalesceKey,
      );
      return { id: screenId, name: updated.name, tree: updated.tree };
    }
    return await persistScreen(folder, screenId, screen, coalesceKey);
  });
}

export async function deletePersistedScreen(folder: DesignFolder, screenId: string): Promise<void> {
  const prev = folder.screens.get(screenId) ?? null;
  recordHistory(folder, { kind: "screen", screenId, screen: prev }, null);
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
  recordHistory(folder, { kind: "board", boardId, board: prev }, validated);
  await writeJsonAtomic(join(folder.root, "boards", `${boardId}.json`), validated);
  folder.boards.set(boardId, validated);
  return validated;
}

/**
 * Write several boards as one act: one history entry holding every board's
 * previous state, so undo puts all of them back in a single step. Validation
 * runs over the whole set before anything is written, so a board the schema
 * rejects can't leave the others half-applied.
 */
export async function persistBoards(
  folder: DesignFolder,
  writes: Array<{ boardId: string; board: Board }>,
): Promise<Board[]> {
  const validated = writes.map(({ boardId, board }) => ({
    boardId,
    board: BoardSchema.parse(board),
  }));
  recordHistory(
    folder,
    {
      kind: "boards",
      boards: validated.map(({ boardId }) => ({
        boardId,
        board: folder.boards.get(boardId) ?? null,
      })),
    },
    validated.map((v) => v.board),
  );
  for (const { boardId, board } of validated) {
    await writeJsonAtomic(join(folder.root, "boards", `${boardId}.json`), board);
    folder.boards.set(boardId, board);
  }
  return validated.map((v) => v.board);
}

export async function deletePersistedBoard(folder: DesignFolder, boardId: string): Promise<void> {
  const prev = folder.boards.get(boardId) ?? null;
  recordHistory(folder, { kind: "board", boardId, board: prev }, null);
  await rm(join(folder.root, "boards", `${boardId}.json`), { force: true });
  await rm(join(folder.root, "boards", `${boardId}.notes.json`), { force: true });
  folder.boards.delete(boardId);
  folder.notes.delete(boardId);
}

async function persistTheme(
  folder: DesignFolder,
  theme: Theme,
  coalesceKey?: string,
): Promise<Theme> {
  const validated = ThemeSchema.parse(theme);
  recordHistory(
    folder,
    {
      kind: "theme",
      themeName: "default",
      theme: folder.theme,
      ...(coalesceKey ? { coalesceKey } : {}),
    },
    validated,
  );
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), validated);
  folder.theme = validated;
  folder.themes.set("default", validated);
  return validated;
}

/**
 * Persist a named theme (`theme/<name>.json`). "default" routes through
 * persistTheme, which owns the `folder.theme` pointer as well as the map.
 *
 * Named themes are undoable on the same terms as the default one: a board
 * pinned to its own theme is edited through exactly the same panel, so ⌘Z
 * doing nothing there would be indistinguishable from the edit not landing.
 * A null snapshot means the file didn't exist, so undo deletes it.
 */
export async function persistNamedTheme(
  folder: DesignFolder,
  name: string,
  theme: Theme,
  coalesceKey?: string,
): Promise<Theme> {
  if (name === "default") return persistTheme(folder, theme, coalesceKey);
  // Clone-on-write copies of the default theme arrive with name "default";
  // the file's internal name must always match its stem.
  const validated = ThemeSchema.parse({ ...theme, name });
  recordHistory(
    folder,
    {
      kind: "theme",
      themeName: name,
      theme: folder.themes.get(name) ?? null,
      ...(coalesceKey ? { coalesceKey } : {}),
    },
    validated,
  );
  await writeJsonAtomic(join(folder.root, "theme", `${name}.json`), validated);
  folder.themes.set(name, validated);
  return validated;
}

export async function persistSnippet(
  folder: DesignFolder,
  snippetId: string,
  snippet: Snippet,
  coalesceKey?: string,
): Promise<Snippet> {
  const validated = SnippetSchema.parse(snippet);
  const prev = folder.snippets.get(snippetId) ?? null;
  recordHistory(folder, { kind: "snippet", snippetId, snippet: prev, coalesceKey }, validated);
  await writeJsonAtomic(join(folder.root, "snippets", `${snippetId}.json`), validated);
  folder.snippets.set(snippetId, validated);
  return validated;
}

export async function deletePersistedSnippet(
  folder: DesignFolder,
  snippetId: string,
): Promise<void> {
  const prev = folder.snippets.get(snippetId);
  if (prev) recordHistory(folder, { kind: "snippet", snippetId, snippet: prev }, null);
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
  // A hand edit to a field the daemon resolved at boot is on disk but not yet
  // running; writing the running value back would undo it before the restart.
  const onDisk = folder.pendingRestart
    ? withBootBound(validated, folder.pendingRestart)
    : validated;
  await writeJsonAtomic(join(folder.root, ".design", "config.json"), onDisk);
  folder.config = validated;
  if (folder.pendingRestart) folder.pendingRestart = onDisk;
  return validated;
}

/** Persist a board's free notes. Empty array deletes the sidecar file. */
export async function persistCanvasNotes(
  folder: DesignFolder,
  boardId: string,
  notes: CanvasNote[],
): Promise<CanvasNote[]> {
  const validated = notes.map((n) => CanvasNoteSchema.parse(n));
  recordHistory(
    folder,
    { kind: "notes", boardId, notes: folder.notes.get(boardId) ?? [] },
    validated,
  );
  const path = join(folder.root, "boards", `${boardId}.notes.json`);
  if (validated.length === 0) {
    await rm(path, { force: true });
  } else {
    await writeJsonAtomic(path, validated);
  }
  folder.notes.set(boardId, validated);
  return validated;
}
