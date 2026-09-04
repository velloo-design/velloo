import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Frame } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { frameIdConflict, type MutationError } from "./errors.ts";
import { getBoard, getScreen } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

export interface AddFrameArgs {
  boardId: string;
  screenId: string;
  x?: number | undefined;
  y?: number | undefined;
  w: number;
  h: number;
  label?: string | undefined;
  group?: string | undefined;
  id?: string | undefined;
}

export interface AddFrameResult {
  frame: Frame;
}

/** Auto-place to the right of the rightmost existing frame. */
function autoPosition(frames: Frame[]): { x: number; y: number } {
  if (frames.length === 0) return { x: 0, y: 0 };
  let maxRight = 0;
  for (const f of frames) if (f.x + f.w > maxRight) maxRight = f.x + f.w;
  return { x: maxRight + 80, y: 0 };
}

function genFrameId(board: { frames: Frame[] }, screenId: string): string {
  const existing = new Set(board.frames.map((f) => f.id));
  let i = 1;
  while (existing.has(`${screenId}-${i}`)) i++;
  return `${screenId}-${i}`;
}

export async function addFrame(
  ctx: MutationContext,
  args: AddFrameArgs,
): Promise<Result<AddFrameResult, MutationError>> {
  return DoAsync<AddFrameResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    yield* $(getScreen(ctx, args.screenId));

    if (args.id !== undefined && board.frames.some((f) => f.id === args.id)) {
      return yield* $(err(frameIdConflict(args.boardId, args.id)));
    }

    const id = args.id ?? genFrameId(board, args.screenId);
    const pos =
      args.x !== undefined && args.y !== undefined
        ? { x: args.x, y: args.y }
        : autoPosition(board.frames);

    const frame: Frame = {
      id,
      screen: args.screenId,
      x: pos.x,
      y: pos.y,
      w: args.w,
      h: args.h,
      ...(args.label !== undefined ? { label: args.label } : {}),
      ...(args.group !== undefined ? { group: args.group } : {}),
    };

    const nextBoard = { ...board, frames: [...board.frames, frame] };
    await persistBoard(ctx.folder, args.boardId, nextBoard);
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { frame };
  });
}
