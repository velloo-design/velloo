import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import { type Board, MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import {
  badRequest,
  boardIdConflict,
  boardIdExhausted,
  lastBoard,
  type MutationError,
} from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { deletePersistedBoard, persistBoard, persistConfig } from "./persist.ts";
import { slugify } from "./slugify.ts";

function boardNameTooLong(name: string): MutationError | null {
  if (name.length <= MAX_BOARD_NAME_LENGTH) return null;
  return badRequest(
    `board name too long (${name.length} chars) — max ${MAX_BOARD_NAME_LENGTH} characters`,
  );
}

export interface AddBoardArgs {
  name: string;
  id?: string;
}

export interface AddBoardResult {
  boardId: string;
  board: Board;
}

export async function addBoard(
  ctx: MutationContext,
  args: AddBoardArgs,
): Promise<Result<AddBoardResult, MutationError>> {
  return DoAsync<AddBoardResult, MutationError>(async function* () {
    const tooLong = boardNameTooLong(args.name);
    if (tooLong) return yield* $(err(tooLong));
    const baseId = args.id ?? slugify(args.name, "board");
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
    if (args.patch.name !== undefined) {
      const tooLong = boardNameTooLong(args.patch.name);
      if (tooLong) return yield* $(err(tooLong));
    }
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

export interface ReorderBoardsArgs {
  /** Board ids in the desired left-sidebar order. */
  order: string[];
}

export interface ReorderBoardsResult {
  /** The persisted order — a sanitized, complete permutation of the folder's boards. */
  order: string[];
}

/**
 * Persist the left-sidebar board order to `config.boardOrder`. The caller
 * sends the order it wants; we drop ids that don't resolve to a board,
 * de-duplicate, then append any boards the caller omitted (in their
 * current order) so the stored order is always a complete permutation.
 * No-op writes (order already matches) still persist — cheap, and keeps
 * the result honest.
 */
export async function reorderBoards(
  ctx: MutationContext,
  args: ReorderBoardsArgs,
): Promise<Result<ReorderBoardsResult, MutationError>> {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of args.order) {
    if (ctx.folder.boards.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of ctx.folder.boards.keys()) {
    if (!seen.has(id)) order.push(id);
  }
  const nextConfig = { ...ctx.folder.config, boardOrder: order };
  await persistConfig(ctx.folder, nextConfig);
  ctx.broadcast({ type: "config-changed" });
  return ok({ order });
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
    // Prune the deleted id from the saved sidebar order so config.json
    // doesn't accumulate dangling ids. Drop the field entirely once
    // nothing's left rather than persisting an empty array.
    const order = ctx.folder.config.boardOrder;
    if (order?.includes(args.boardId)) {
      const pruned = order.filter((id) => id !== args.boardId);
      const nextConfig = {
        ...ctx.folder.config,
        boardOrder: pruned.length > 0 ? pruned : undefined,
      };
      await persistConfig(ctx.folder, nextConfig);
    }
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { removedBoardId: args.boardId };
  });
}
