import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import { type Board, MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import { orderedBoards } from "../design-folder.ts";
import { resolveGroup } from "./board-groups.ts";
import type { MutationContext } from "./context.ts";
import { badRequest, boardIdConflict, boardIdExhausted, type MutationError } from "./errors.ts";
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
  id?: string | undefined;
  /**
   * Sidebar group to file the board under — an existing group's id or name,
   * or a new name, which creates the group (see {@link resolveGroup}).
   */
  group?: string | undefined;
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

    let groupId: string | undefined;
    if (args.group !== undefined) {
      const resolved = yield* $(resolveGroup(ctx.folder.config, args.group));
      groupId = resolved.groupId;
      if (resolved.config !== ctx.folder.config) {
        await persistConfig(ctx.folder, resolved.config);
        ctx.broadcast({ type: "config-changed" });
      }
    }

    const board: Board = {
      id: boardId,
      name: args.name,
      ...(groupId ? { group: groupId } : {}),
      frames: [],
      groups: [],
    };
    await persistBoard(ctx.folder, boardId, board);
    ctx.broadcast({ type: "board-changed", boardId });
    return { boardId, board };
  });
}

export interface UpdateBoardArgs {
  boardId: string;
  patch: {
    name?: string | undefined;
    /** Named theme for the board's frames; null clears back to default. */
    theme?: string | null | undefined;
    /** true stamps `archivedAt` with now; false clears it. */
    archived?: boolean | undefined;
    /**
     * Sidebar group — an existing group's id or name, or a new name (which
     * creates the group). null files the board back under Ungrouped.
     */
    group?: string | null | undefined;
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
    if (args.patch.group !== undefined) {
      if (args.patch.group === null) delete next.group;
      else {
        const resolved = yield* $(resolveGroup(ctx.folder.config, args.patch.group));
        next.group = resolved.groupId;
        if (resolved.config !== ctx.folder.config) {
          await persistConfig(ctx.folder, resolved.config);
          ctx.broadcast({ type: "config-changed" });
        }
      }
    }
    if (args.patch.archived !== undefined) {
      // Re-archiving an already-archived board refreshes the stamp rather
      // than preserving the original date — "archived <when>" should read as
      // the last time the user put it away.
      if (args.patch.archived) next.archivedAt = new Date().toISOString();
      else delete next.archivedAt;
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
 * sends the order it wants; we drop ids that don't resolve to a board and
 * de-duplicate, then splice the survivors back into the folder's current
 * order so the stored order is always a complete permutation.
 *
 * Omitted boards **keep their slots** rather than being appended. That's what
 * makes archiving non-destructive to ordering: the sidebar reorders the live
 * boards it can see, and an archived board still sitting between two of them
 * returns to that spot on unarchive instead of the bottom of the list.
 * No-op writes (order already matches) still persist — cheap, and keeps
 * the result honest.
 */
export async function reorderBoards(
  ctx: MutationContext,
  args: ReorderBoardsArgs,
): Promise<Result<ReorderBoardsResult, MutationError>> {
  const seen = new Set<string>();
  const moved: string[] = [];
  for (const id of args.order) {
    if (ctx.folder.boards.has(id) && !seen.has(id)) {
      moved.push(id);
      seen.add(id);
    }
  }
  // Walk the current display order; each slot held by a board the caller is
  // moving gets refilled from `moved` in sequence, everything else stays put.
  const current = orderedBoards(ctx.folder).map(([id]) => id);
  let next = 0;
  const order = current.map((id) => (seen.has(id) ? (moved[next++] as string) : id));
  for (const id of moved.slice(next)) order.push(id);
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
    // No last-board rule: a folder with zero boards is a supported state
    // (the sidebar has an empty state, the MCP instructions have `bareFolder`),
    // so removing the only board is the user's call.
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
