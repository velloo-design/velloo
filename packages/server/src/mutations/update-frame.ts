import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Frame } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { frameNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

export interface FramePatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string | null;
  group?: string | null;
}

export interface UpdateFrameArgs {
  boardId: string;
  frameId: string;
  patch: FramePatch;
}

export interface UpdateFrameResult {
  frame: Frame;
}

function applyPatch(frame: Frame, patch: FramePatch): Frame {
  const next: Frame = { ...frame };
  if (patch.x !== undefined) next.x = patch.x;
  if (patch.y !== undefined) next.y = patch.y;
  if (patch.w !== undefined) next.w = patch.w;
  if (patch.h !== undefined) next.h = patch.h;
  if (patch.label !== undefined) {
    if (patch.label === null) {
      const { label: _l, ...rest } = next;
      return rest as Frame;
    }
    next.label = patch.label;
  }
  if (patch.group !== undefined) {
    if (patch.group === null) {
      const { group: _g, ...rest } = next;
      return rest as Frame;
    }
    next.group = patch.group;
  }
  return next;
}

export async function updateFrame(
  ctx: MutationContext,
  args: UpdateFrameArgs,
): Promise<Result<UpdateFrameResult, MutationError>> {
  return DoAsync<UpdateFrameResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const idx = board.frames.findIndex((f) => f.id === args.frameId);
    if (idx === -1) return yield* $(err(frameNotFound(args.boardId, args.frameId)));

    const updated = applyPatch(board.frames[idx] as Frame, args.patch);
    const nextFrames = [...board.frames];
    nextFrames[idx] = updated;
    await persistBoard(ctx.folder, args.boardId, { ...board, frames: nextFrames });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { frame: updated };
  });
}

export interface UpdateFramesArgs {
  boardId: string;
  patches: Array<{ frameId: string; patch: FramePatch }>;
}

export interface UpdateFramesResult {
  frames: Frame[];
}

export async function updateFrames(
  ctx: MutationContext,
  args: UpdateFramesArgs,
): Promise<Result<UpdateFramesResult, MutationError>> {
  return DoAsync<UpdateFramesResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const nextFrames = [...board.frames];
    for (const { frameId, patch } of args.patches) {
      const idx = nextFrames.findIndex((f) => f.id === frameId);
      if (idx === -1) return yield* $(err(frameNotFound(args.boardId, frameId)));
      nextFrames[idx] = applyPatch(nextFrames[idx] as Frame, patch);
    }
    await persistBoard(ctx.folder, args.boardId, { ...board, frames: nextFrames });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { frames: nextFrames };
  });
}
