import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Frame } from "@velloo/schema";
import { autoPosition, genFrameId } from "./add-frame.ts";
import type { MutationContext } from "./context.ts";
import { frameNotFound, invalidMove, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoards } from "./persist.ts";

export interface MoveFrameArgs {
  boardId: string;
  frameId: string;
  toBoardId: string;
  x?: number | undefined;
  y?: number | undefined;
}

export interface MoveFrameResult {
  /** The placement as it now exists on the target board — its id may differ. */
  frame: Frame;
  fromBoardId: string;
  toBoardId: string;
}

/**
 * Re-file one placement onto another board: same screen, same size, new home.
 * The screen itself is untouched, so every other frame of it — including ones
 * on the source board — keeps rendering unchanged.
 *
 * Two things don't survive the crossing. Frame ids are unique per board, so a
 * collision on the target gets a fresh one (reported back in the result). And
 * `group` names a region of the *source* board, which doesn't exist on the
 * target, so the frame arrives ungrouped.
 */
export async function moveFrame(
  ctx: MutationContext,
  args: MoveFrameArgs,
): Promise<Result<MoveFrameResult, MutationError>> {
  return DoAsync<MoveFrameResult, MutationError>(async function* () {
    const from = yield* $(getBoard(ctx, args.boardId));
    const to = yield* $(getBoard(ctx, args.toBoardId));
    if (args.boardId === args.toBoardId) {
      return yield* $(
        err(
          invalidMove(
            `Frame "${args.frameId}" is already on board "${args.boardId}" — use update_frame to reposition it.`,
          ),
        ),
      );
    }
    const frame = from.frames.find((f) => f.id === args.frameId);
    if (!frame) return yield* $(err(frameNotFound(args.boardId, args.frameId)));

    const pos =
      args.x !== undefined && args.y !== undefined
        ? { x: args.x, y: args.y }
        : autoPosition(to.frames);
    const taken = to.frames.some((f) => f.id === frame.id);
    const { group: _dropped, ...carried } = frame;
    const moved: Frame = {
      ...carried,
      id: taken ? genFrameId(to, frame.screen) : frame.id,
      x: pos.x,
      y: pos.y,
    };

    // One history entry for both writes, so ⌘Z returns the frame in a single
    // step rather than passing through a half-moved state. Target first:
    // should the process die between the two writes, the frame is left
    // duplicated — visible and fixable — rather than on neither board.
    await persistBoards(ctx.folder, [
      { boardId: args.toBoardId, board: { ...to, frames: [...to.frames, moved] } },
      {
        boardId: args.boardId,
        board: { ...from, frames: from.frames.filter((f) => f.id !== args.frameId) },
      },
    ]);
    ctx.broadcast({ type: "board-changed", boardId: args.toBoardId });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { frame: moved, fromBoardId: args.boardId, toBoardId: args.toBoardId };
  });
}
