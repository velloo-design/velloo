import { $, DoAsync, type Result } from "@velloo/result";
import type { Page } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getPage } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface UpdatePageArgs {
  pageId: string;
  /** Sparse patch — only `name` is supported today. */
  patch: {
    name?: string;
  };
}

export interface UpdatePageResult {
  page: Page;
}

/**
 * Update page-level metadata. Only the display name today; the page id stays
 * stable so existing pageId references (URL state, MCP calls in flight) don't
 * break on a rename.
 */
export async function updatePage(
  ctx: MutationContext,
  args: UpdatePageArgs,
): Promise<Result<UpdatePageResult, MutationError>> {
  return DoAsync<UpdatePageResult, MutationError>(async function* () {
    const page = yield* $(getPage(ctx, args.pageId));
    const next = clonePage(page);
    if (args.patch.name !== undefined) next.name = args.patch.name;
    await persistPage(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { page: next };
  });
}
