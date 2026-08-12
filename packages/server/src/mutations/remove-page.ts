import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@velloo/schema";
import { pushHistory } from "../history.ts";
import type { MutationContext } from "./context.ts";
import { MutationError } from "./errors.ts";

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
): Promise<RemovePageResult> {
  const existing = ctx.folder.pages.get(args.pageId);
  if (!existing) {
    throw new MutationError({
      code: "PAGE_NOT_FOUND",
      message: `Page not found: ${JSON.stringify(args.pageId)}`,
    });
  }
  if (ctx.folder.pages.size <= 1) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: "A design must have at least one page.",
    });
  }

  // Snapshot the deleted page so undo can put it back.
  pushHistory({ kind: "page", pageId: args.pageId, page: existing as Page });

  const path = join(ctx.folder.root, "pages", `${args.pageId}.json`);
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  ctx.folder.pages.delete(args.pageId);
  ctx.broadcast({ type: "page-changed", pageId: args.pageId });
  return { removedPageId: args.pageId };
}
