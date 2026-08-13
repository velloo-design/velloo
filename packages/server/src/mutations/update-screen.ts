import { $, DoAsync, type Result } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { cloneScreen } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { persistScreen } from "./persist.ts";

export interface UpdateScreenArgs {
  screenId: string;
  /** Sparse patch — only `name` is supported today. */
  patch: { name?: string };
}

export interface UpdateScreenResult {
  screen: Screen;
}

/**
 * Update screen-level metadata. Only the display name today; the screen id
 * stays stable so frame references and URLs don't break on rename.
 */
export async function updateScreen(
  ctx: MutationContext,
  args: UpdateScreenArgs,
): Promise<Result<UpdateScreenResult, MutationError>> {
  return DoAsync<UpdateScreenResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);
    if (args.patch.name !== undefined) next.name = args.patch.name;
    await persistScreen(ctx.folder, args.screenId, next);
    ctx.broadcast({ type: "screen-changed", screenId: args.screenId });
    return { screen: next };
  });
}
