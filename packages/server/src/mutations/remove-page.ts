import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@velloo/result";
import type { Page } from "@velloo/schema";
import { pushHistory } from "../history.ts";
import type { MutationContext } from "./context.ts";
import { lastPage, type MutationError, pageNotFound } from "./errors.ts";

export interface RemovePageArgs {
  pageId: string;
}

export interface RemovePageResult {
  removedPageId: string;
}

/**
 * Delete a page from disk and the in-memory cache. Refuses to remove the last
 * page (every design needs at least one). Pushes the deleted page onto the
 * history stack so ⌘Z can resurrect it.
 */
export async function removePage(
  ctx: MutationContext,
  args: RemovePageArgs,
): Promise<Result<RemovePageResult, MutationError>> {
  const existing = ctx.folder.pages.get(args.pageId);
  if (!existing) return err(pageNotFound(args.pageId));
  if (ctx.folder.pages.size <= 1) return err(lastPage(args.pageId));

  // Snapshot the deleted page so undo can put it back.
  pushHistory({ kind: "page", pageId: args.pageId, page: existing as Page });

  const path = join(ctx.folder.root, "pages", `${args.pageId}.json`);
  try {
    await unlink(path);
  } catch (fsErr) {
    if ((fsErr as NodeJS.ErrnoException).code !== "ENOENT") throw fsErr;
  }
  ctx.folder.pages.delete(args.pageId);
  ctx.broadcast({ type: "page-changed", pageId: args.pageId });
  return ok({ removedPageId: args.pageId });
}
