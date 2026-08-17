import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Board } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { boardIdConflict, boardIdExhausted, lastBoard, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { deletePersistedBoard, persistBoard } from "./persist.ts";

export interface AddBoardArgs {
  name: string;
  id?: string;
}

export interface AddBoardResult {
  boardId: string;
  board: Board;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "board"
  );
}

export async function addBoard(
  ctx: MutationContext,
  args: AddBoardArgs,
): Promise<Result<AddBoardResult, MutationError>> {
  return DoAsync<AddBoardResult, MutationError>(async function* () {
    const baseId = args.id ?? slugify(args.name);
    if (args.id !== undefined && ctx.folder.boards.has(args.id)) {
      return yield* $(err(boardIdConflict(args.id)));
    }
    let boardId = baseId;
    let attempt = 2;
    while (ctx.folder.boards.has(boardId)) {
      boardId = `${baseId}-${attempt++}`;
      if (attempt > 100) return yield* $(err(boardIdExhausted(baseId)));
    }

    const board: Board = { id: boardId, name: args.name, frames: [], groups: [] };
    await persistBoard(ctx.folder, boardId, board);
    ctx.broadcast({ type: "board-changed", boardId });
    return { boardId, board };
  });
}

export interface UpdateBoardArgs {
  boardId: string;
  patch: {
    name?: string;
    /** Named theme for the board's frames; null clears back to default. */
    theme?: string | null;
  };
}

export interface UpdateBoardResult {
  board: Board;
}

export async function updateBoard(
  ctx: MutationContext,
  args: UpdateBoardArgs,
): Promise<Result<UpdateBoardResult, MutationError>> {
  return DoAsync<UpdateBoardResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const next: Board = { ...board };
    if (args.patch.name !== undefined) next.name = args.patch.name;
    if (args.patch.theme !== undefined) {
      if (args.patch.theme === null) delete next.theme;
      else next.theme = args.patch.theme;
    }
    await persistBoard(ctx.folder, args.boardId, next);
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { board: next };
  });
}

export interface RemoveBoardArgs {
  boardId: string;
}

export interface RemoveBoardResult {
  removedBoardId: string;
}

export async function removeBoard(
  ctx: MutationContext,
  args: RemoveBoardArgs,
): Promise<Result<RemoveBoardResult, MutationError>> {
  return DoAsync<RemoveBoardResult, MutationError>(async function* () {
    yield* $(getBoard(ctx, args.boardId));
    if (ctx.folder.boards.size <= 1) {
      return yield* $(err(lastBoard(args.boardId)));
    }
    await deletePersistedBoard(ctx.folder, args.boardId);
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { removedBoardId: args.boardId };
  });
}
