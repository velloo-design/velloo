import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Board, Screen, Snippet, Theme } from "@velloo/schema";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import type { HistoryEntry } from "../history.ts";
import { withBoardLock, withScreenLock, withSnippetLock } from "../mutations/context.ts";
import type { WatchEvent } from "../watcher.ts";

type Reverted =
  | { kind: "screen"; screenId: string }
  | { kind: "board"; boardId: string }
  | { kind: "theme"; themeName: string }
  | { kind: "snippet"; snippetId: string };

export function createUndoRouter(
  folderFor: () => DesignFolder,
  broadcast: (e: WatchEvent) => void,
): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json(folderFor().history.depths()));

  r.post("/", async (c) => {
    const folder = folderFor();
    const entry = folder.history.popUndo();
    if (!entry) return c.json({ reverted: null, ...folder.history.depths() });
    return c.json({
      reverted: await applyRevert(entry, folder, broadcast, "redo"),
      ...folder.history.depths(),
    });
  });

  r.post("/redo", async (c) => {
    const folder = folderFor();
    const entry = folder.history.popRedo();
    if (!entry) return c.json({ reverted: null, ...folder.history.depths() });
    return c.json({
      reverted: await applyRevert(entry, folder, broadcast, "undo"),
      ...folder.history.depths(),
    });
  });

  return r;
}

async function applyRevert(
  entry: HistoryEntry,
  folder: DesignFolder,
  broadcast: (e: WatchEvent) => void,
  pushOpposite: "redo" | "undo",
): Promise<Reverted> {
  if (entry.kind === "screen") {
    const current = folder.screens.get(entry.screenId) ?? null;
    const back: HistoryEntry = { kind: "screen", screenId: entry.screenId, screen: current };
    if (pushOpposite === "redo") folder.history.pushRedo(back);
    else folder.history.pushUndoSilent(back);
    await withScreenLock(folder, entry.screenId, async () => {
      if (entry.screen === null) {
        await deleteScreen(folder, entry.screenId);
      } else {
        await writeScreen(folder, entry.screenId, entry.screen);
      }
    });
    broadcast({ type: "screen-changed", screenId: entry.screenId });
    return { kind: "screen", screenId: entry.screenId };
  }

  if (entry.kind === "board") {
    const current = folder.boards.get(entry.boardId) ?? null;
    const back: HistoryEntry = { kind: "board", boardId: entry.boardId, board: current };
    if (pushOpposite === "redo") folder.history.pushRedo(back);
    else folder.history.pushUndoSilent(back);
    await withBoardLock(folder, entry.boardId, async () => {
      if (entry.board === null) {
        await deleteBoard(folder, entry.boardId);
      } else {
        await writeBoard(folder, entry.boardId, entry.board);
      }
    });
    broadcast({ type: "board-changed", boardId: entry.boardId });
    return { kind: "board", boardId: entry.boardId };
  }

  if (entry.kind === "snippet") {
    const current = folder.snippets.get(entry.snippetId) ?? null;
    const back: HistoryEntry = { kind: "snippet", snippetId: entry.snippetId, snippet: current };
    if (pushOpposite === "redo") folder.history.pushRedo(back);
    else folder.history.pushUndoSilent(back);
    await withSnippetLock(folder, entry.snippetId, async () => {
      if (entry.snippet === null) {
        await deleteSnippet(folder, entry.snippetId);
      } else {
        await writeSnippet(folder, entry.snippetId, entry.snippet);
      }
    });
    broadcast({ type: "snippet-changed", snippetId: entry.snippetId });
    return { kind: "snippet", snippetId: entry.snippetId };
  }

  const name = entry.themeName;
  const current = name === "default" ? folder.theme : (folder.themes.get(name) ?? null);
  const back: HistoryEntry = { kind: "theme", themeName: name, theme: current };
  if (pushOpposite === "redo") folder.history.pushRedo(back);
  else folder.history.pushUndoSilent(back);
  await writeTheme(folder, name, entry.theme);
  broadcast({ type: "theme-changed" });
  return { kind: "theme", themeName: name };
}

async function writeScreen(folder: DesignFolder, screenId: string, screen: Screen): Promise<void> {
  await writeJsonAtomic(join(folder.root, "screens", `${screenId}.json`), screen);
  folder.screens.set(screenId, screen);
}

async function deleteScreen(folder: DesignFolder, screenId: string): Promise<void> {
  await rm(join(folder.root, "screens", `${screenId}.json`), { force: true });
  folder.screens.delete(screenId);
}

async function writeBoard(folder: DesignFolder, boardId: string, board: Board): Promise<void> {
  await writeJsonAtomic(join(folder.root, "boards", `${boardId}.json`), board);
  folder.boards.set(boardId, board);
}

async function deleteBoard(folder: DesignFolder, boardId: string): Promise<void> {
  await rm(join(folder.root, "boards", `${boardId}.json`), { force: true });
  folder.boards.delete(boardId);
}

/**
 * Restore one theme file.
 *
 * `folder.themes` has to be written alongside `folder.theme`, because
 * `themeByName` reads the map and every theme mutation merges its edit onto
 * whatever that returns. Leaving the map holding the pre-undo snapshot means
 * the next single-control edit re-persists the state the undo just reverted,
 * with only the touched control updated. The watcher does eventually reload and
 * repair the map, but it debounces — so the bug is a race, and looks
 * intermittent.
 */
async function writeTheme(folder: DesignFolder, name: string, theme: Theme | null): Promise<void> {
  const path = join(folder.root, "theme", `${name}.json`);
  // The default theme is the folder's floor — `folder.theme` is non-nullable
  // and every render falls back to it, so there is no state where deleting it
  // is the correct revert.
  if (theme === null && name !== "default") {
    await rm(path, { force: true });
    folder.themes.delete(name);
    return;
  }
  if (theme === null) return;
  await writeJsonAtomic(path, theme);
  folder.themes.set(name, theme);
  if (name === "default") folder.theme = theme;
}

async function writeSnippet(
  folder: DesignFolder,
  snippetId: string,
  snippet: Snippet,
): Promise<void> {
  await writeJsonAtomic(join(folder.root, "snippets", `${snippetId}.json`), snippet);
  folder.snippets.set(snippetId, snippet);
}

async function deleteSnippet(folder: DesignFolder, snippetId: string): Promise<void> {
  await rm(join(folder.root, "snippets", `${snippetId}.json`), { force: true });
  folder.snippets.delete(snippetId);
}
