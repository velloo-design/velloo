import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { lastScreen, type MutationError } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { deletePersistedScreen, persistBoard } from "./persist.ts";

export interface RemoveScreenArgs {
  screenId: string;
}

export interface RemoveScreenResult {
  removedScreenId: string;
  /** boardId → frameIds removed (the frames referencing this screen). */
  removedFrames: { boardId: string; frameIds: string[] }[];
}

/**
 * Delete a screen from disk + cache. Refuses to remove the last screen.
 * Cascades to frames across *every* board: any frame referencing this
 * screen is removed alongside it.
 */
export async function removeScreen(
  ctx: MutationContext,
  args: RemoveScreenArgs,
): Promise<Result<RemoveScreenResult, MutationError>> {
  return DoAsync<RemoveScreenResult, MutationError>(async function* () {
    yield* $(getScreen(ctx, args.screenId));
    if (ctx.folder.screens.size <= 1) {
      return yield* $(err(lastScreen(args.screenId)));
    }

    const removedFrames: { boardId: string; frameIds: string[] }[] = [];
    for (const [boardId, board] of ctx.folder.boards) {
      const referencing = board.frames.filter((f) => f.screen === args.screenId);
      if (referencing.length === 0) continue;
      const nextBoard = {
        ...board,
        frames: board.frames.filter((f) => f.screen !== args.screenId),
      };
      await persistBoard(ctx.folder, boardId, nextBoard);
      ctx.broadcast({ type: "board-changed", boardId });
      removedFrames.push({ boardId, frameIds: referencing.map((f) => f.id) });
    }

    await deletePersistedScreen(ctx.folder, args.screenId);
    ctx.broadcast({ type: "screen-changed", screenId: args.screenId });
    return { removedScreenId: args.screenId, removedFrames };
  });
}
