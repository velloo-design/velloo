import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Frame } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { frameIdConflict, type MutationError } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

export interface AddFrameArgs {
  screenId: string;
  x?: number;
  y?: number;
  w: number;
  h: number;
  label?: string;
  group?: string;
  id?: string;
}

export interface AddFrameResult {
  frame: Frame;
}

/**
 * Pick a free spot on the board for an auto-placed frame. Right of the
 * rightmost existing frame, with a 80px gutter.
 */
function autoPosition(ctx: MutationContext, w: number): { x: number; y: number } {
  const frames = ctx.folder.board.frames;
  if (frames.length === 0) return { x: 0, y: 0 };
  let maxRight = 0;
  for (const f of frames) {
    if (f.x + f.w > maxRight) maxRight = f.x + f.w;
  }
  return { x: maxRight + 80, y: 0 };
}

function genFrameId(ctx: MutationContext, screenId: string): string {
  const existing = new Set(ctx.folder.board.frames.map((f) => f.id));
  let i = 1;
  while (existing.has(`${screenId}-${i}`)) i++;
  return `${screenId}-${i}`;
}

/** Place a screen on the board at a chosen size + position. */
export async function addFrame(
  ctx: MutationContext,
  args: AddFrameArgs,
): Promise<Result<AddFrameResult, MutationError>> {
  return DoAsync<AddFrameResult, MutationError>(async function* () {
    yield* $(getScreen(ctx, args.screenId));

    if (args.id !== undefined && ctx.folder.board.frames.some((f) => f.id === args.id)) {
      return yield* $(err(frameIdConflict(args.id)));
    }

    const id = args.id ?? genFrameId(ctx, args.screenId);
    const pos =
      args.x !== undefined && args.y !== undefined
        ? { x: args.x, y: args.y }
        : autoPosition(ctx, args.w);

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

    const nextBoard = {
      ...ctx.folder.board,
      frames: [...ctx.folder.board.frames, frame],
    };
    await persistBoard(ctx.folder, nextBoard);
    ctx.broadcast({ type: "board-changed" });
    return { frame };
  });
}
