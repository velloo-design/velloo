import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Snippet, Theme } from "@velloo/schema";
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
import { withPageLock } from "../mutations/context.ts";
import type { WatchEvent } from "../watcher.ts";

type Reverted =
  | { kind: "page"; pageId: string }
  | { kind: "theme" }
  | { kind: "snippet"; snippetId: string };

/**
 * Single-level revert / replay. POPs from the undo (or redo) stack, snapshots
 * the *current* state to the opposite stack, and re-writes the popped entry
 * to disk + cache. We bypass persistPage on purpose — undo/redo flips
 * between the two stacks and must not clear redo by going through persist.
 */
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
  if (entry.kind === "page") {
    // Snapshot what we're about to overwrite so the inverse stack can put it back.
    const current = folder.pages.get(entry.pageId);
    if (current) {
      const back: HistoryEntry = { kind: "page", pageId: entry.pageId, page: current };
      if (pushOpposite === "redo") pushRedo(back);
      else pushUndoSilent(back);
    }
    await withPageLock(entry.pageId, async () => {
      await writePage(folder, entry.pageId, entry.page);
    });
    broadcast({ type: "page-changed", pageId: entry.pageId });
    return { kind: "page", pageId: entry.pageId };
  }

  if (entry.kind === "snippet") {
    const current = folder.snippets.get(entry.snippetId) ?? null;
    const back: HistoryEntry = { kind: "snippet", snippetId: entry.snippetId, snippet: current };
    if (pushOpposite === "redo") pushRedo(back);
    else pushUndoSilent(back);
    if (entry.snippet === null) {
      // The previous state was "didn't exist" — restore that by deleting.
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

async function writePage(folder: DesignFolder, pageId: string, page: Page): Promise<void> {
  await writeJsonAtomic(join(folder.root, "pages", `${pageId}.json`), page);
  folder.pages.set(pageId, page);
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
