import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { lastScreen, type MutationError, screenInUse } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { deletePersistedScreen, persistBoard } from "./persist.ts";

export interface RemoveScreenArgs {
  screenId: string;
}

export interface RemoveScreenResult {
  removedScreenId: string;
  /** Frame ids that were also removed because they referenced this screen. */
  removedFrameIds: string[];
}

/**
 * Delete a screen from disk + cache. Refuses to remove the last screen.
 * Cascades to frames on the board: any frame referencing this screen is
 * removed along with it (one persist for the board, one for the screen).
 */
export async function removeScreen(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return DoAsync<RemoveScreenResult, MutationError>(async function* () {
    yield* $(getScreen(ctx, args.screenId)); // existence check
    if (ctx.folder.screens.size <= 1) {
      return yield* $(err(lastScreen(args.screenId)));
    }

    const referencingFrames = ctx.folder.board.frames.filter((f) => f.screen === args.screenId);
    if (referencingFrames.length > 0) {
      const nextBoard = {
        ...ctx.folder.board,
        frames: ctx.folder.board.frames.filter((f) => f.screen !== args.screenId),
      };
      await persistBoard(ctx.folder, nextBoard);
      ctx.broadcast({ type: "board-changed" });
    }

    await deletePersistedScreen(ctx.folder, args.screenId);
    ctx.broadcast({ type: "screen-changed", screenId: args.screenId });
    return {
      removedScreenId: args.screenId,
      removedFrameIds: referencingFrames.map((f) => f.id),
    };
  });
}

/** Stricter variant: refuses if any frame still references the screen. */
export async function removeScreenStrict(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return DoAsync<RemoveScreenResult, MutationError>(async function* () {
    yield* $(getScreen(ctx, args.screenId));
    if (ctx.folder.screens.size <= 1) {
      return yield* $(err(lastScreen(args.screenId)));
    }
    const referencing = ctx.folder.board.frames.filter((f) => f.screen === args.screenId);
    if (referencing.length > 0) {
      return yield* $(err(screenInUse(args.screenId, referencing.map((f) => f.id))));
    }
    await deletePersistedScreen(ctx.folder, args.screenId);
    ctx.broadcast({ type: "screen-changed", screenId: args.screenId });
    return { removedScreenId: args.screenId, removedFrameIds: [] };
  });
}
