import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Board, Screen, Snippet, Theme } from "@velloo/schema";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import {
  type HistoryEntry,
  historyDepths,
  popRedo,
  popUndo,
  pushRedo,
  pushUndoSilent,
} from "../history.ts";
import { withBoardLock, withScreenLock } from "../mutations/context.ts";
import type { WatchEvent } from "../watcher.ts";

type Reverted =
  | { kind: "screen"; screenId: string }
  | { kind: "board"; boardId: string }
  | { kind: "theme" }
  | { kind: "snippet"; snippetId: string };

export function createUndoRouter(
  folderFor: () => DesignFolder,
  broadcast: (e: WatchEvent) => void,
): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json(historyDepths()));

  r.post("/", async (c) => {
    const entry = popUndo();
    if (!entry) return c.json({ reverted: null, ...historyDepths() });
    return c.json({
      reverted: await applyRevert(entry, folderFor(), broadcast, "redo"),
      ...historyDepths(),
    });
  });

  r.post("/redo", async (c) => {
    const entry = popRedo();
    if (!entry) return c.json({ reverted: null, ...historyDepths() });
    return c.json({
      reverted: await applyRevert(entry, folderFor(), broadcast, "undo"),
      ...historyDepths(),
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
    if (pushOpposite === "redo") pushRedo(back);
    else pushUndoSilent(back);
    await withScreenLock(entry.screenId, async () => {
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
    if (pushOpposite === "redo") pushRedo(back);
    else pushUndoSilent(back);
    await withBoardLock(entry.boardId, async () => {
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
    if (pushOpposite === "redo") pushRedo(back);
    else pushUndoSilent(back);
    if (entry.snippet === null) {
      await deleteSnippet(folder, entry.snippetId);
    } else {
      await writeSnippet(folder, entry.snippetId, entry.snippet);
    }
    broadcast({ type: "snippet-changed", snippetId: entry.snippetId });
    return { kind: "snippet", snippetId: entry.snippetId };
  }

  const current = folder.theme;
  const back: HistoryEntry = { kind: "theme", theme: current };
  if (pushOpposite === "redo") pushRedo(back);
  else pushUndoSilent(back);
  await writeTheme(folder, entry.theme);
  broadcast({ type: "theme-changed" });
  return { kind: "theme" };
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

async function writeTheme(folder: DesignFolder, theme: Theme): Promise<void> {
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), theme);
  folder.theme = theme;
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
