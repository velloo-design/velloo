import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Frame } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { frameNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

interface FramePatch {
  x?: number | undefined;
  y?: number | undefined;
  w?: number | undefined;
  h?: number | undefined;
  label?: string | null | undefined;
  group?: string | null | undefined;
  scheme?: "light" | "dark" | null | undefined;
  fit?: "content" | null | undefined;
}

function applyPatch(frame: Frame, patch: FramePatch): Frame {
  const next: Frame = { ...frame };
  if (patch.x !== undefined) next.x = patch.x;
  if (patch.y !== undefined) next.y = patch.y;
  if (patch.w !== undefined) next.w = patch.w;
  if (patch.h !== undefined) next.h = patch.h;
  // A height someone chose is theirs: the frame stops following its screen.
  // (The canvas sends the whole box on a move, so only a height that changed.)
  if (patch.fit === "content") next.fit = "content";
  else if (patch.fit === null || (patch.h !== undefined && patch.h !== frame.h)) delete next.fit;
  if (patch.label !== undefined) {
    if (patch.label === null) {
      delete next.label;
    } else {
      next.label = patch.label;
    }
  }
  if (patch.group !== undefined) {
    if (patch.group === null) {
      delete next.group;
    } else {
      next.group = patch.group;
    }
  }
  if (patch.scheme !== undefined) {
    if (patch.scheme === null) {
      delete next.scheme;
    } else {
      next.scheme = patch.scheme;
    }
  }
  return next;
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
