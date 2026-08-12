import { join } from "node:path";
import type { Page, Theme } from "@velloo/schema";
import { Hono } from "hono";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { historyDepth, popHistory } from "../history.ts";
import { withPageLock } from "../mutations/context.ts";
import type { WatchEvent } from "../watcher.ts";

/**
 * Single-level revert. POPs the most recent persistPage/persistTheme snapshot
 * and re-writes it to disk + cache. We bypass persistPage on purpose — undo
 * itself should not push another history entry in V0.
 */
export function createUndoRouter(
  folderFor: () => DesignFolder,
  broadcast: (e: WatchEvent) => void,
): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json({ depth: historyDepth() }));

  r.post("/", async (c) => {
    const entry = popHistory();
    if (!entry) {
      return c.json({ reverted: null, depth: 0 });
    }
    const folder = folderFor();

    if (entry.kind === "page") {
      await withPageLock(entry.pageId, async () => {
        await writePage(folder, entry.pageId, entry.page);
      });
      broadcast({ type: "page-changed", pageId: entry.pageId });
      return c.json({ reverted: { kind: "page", pageId: entry.pageId }, depth: historyDepth() });
    }

    await writeTheme(folder, entry.theme);
    broadcast({ type: "theme-changed" });
    return c.json({ reverted: { kind: "theme" }, depth: historyDepth() });
  });

  return r;
}

async function writePage(folder: DesignFolder, pageId: string, page: Page): Promise<void> {
  await writeJsonAtomic(join(folder.root, "pages", `${pageId}.json`), page);
  folder.pages.set(pageId, page);
}

async function writeTheme(folder: DesignFolder, theme: Theme): Promise<void> {
  await writeJsonAtomic(join(folder.root, "theme", "default.json"), theme);
  folder.theme = theme;
}
