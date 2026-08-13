import { $, DoAsync, err, type Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import { frameNotFound, type MutationError } from "./errors.ts";
import { persistBoard } from "./persist.ts";

export interface RemoveFrameArgs {
  frameId: string;
}

export interface RemoveFrameResult {
  removedFrameId: string;
}

/** Remove a frame placement. The underlying screen is left intact. */
export async function removeFrame(
  ctx: MutationContext,
  args: RemoveFrameArgs,
): Promise<Result<RemoveFrameResult, MutationError>> {
  return DoAsync<RemoveFrameResult, MutationError>(async function* () {
    const idx = ctx.folder.board.frames.findIndex((f) => f.id === args.frameId);
    if (idx === -1) return yield* $(err(frameNotFound(args.frameId)));
    const nextFrames = ctx.folder.board.frames.filter((f) => f.id !== args.frameId);
    await persistBoard(ctx.folder, { ...ctx.folder.board, frames: nextFrames });
    ctx.broadcast({ type: "board-changed" });
    return { removedFrameId: args.frameId };
  });
}
