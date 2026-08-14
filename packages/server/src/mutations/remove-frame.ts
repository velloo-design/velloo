import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { frameNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

export interface RemoveFrameArgs {
  boardId: string;
  frameId: string;
}

export interface RemoveFrameResult {
  removedFrameId: string;
}

export async function removeFrame(
  ctx: MutationContext,
  args: RemoveFrameArgs,
): Promise<Result<RemoveFrameResult, MutationError>> {
  return DoAsync<RemoveFrameResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const idx = board.frames.findIndex((f) => f.id === args.frameId);
    if (idx === -1) return yield* $(err(frameNotFound(args.boardId, args.frameId)));
    const nextFrames = board.frames.filter((f) => f.id !== args.frameId);
    await persistBoard(ctx.folder, args.boardId, { ...board, frames: nextFrames });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { removedFrameId: args.frameId };
  });
}
