import { $, DoAsync, err, type Result } from "@velloo/result";
import type { BoardGroup } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { groupIdConflict, groupNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

export interface AddGroupArgs {
  boardId: string;
  name: string;
  color?: string;
  id?: string;
}

export interface AddGroupResult {
  group: BoardGroup;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "group"
  );
}

export async function addGroup(
  ctx: MutationContext,
  args: AddGroupArgs,
): Promise<Result<AddGroupResult, MutationError>> {
  return DoAsync<AddGroupResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const baseId = args.id ?? slugify(args.name);
    if (args.id !== undefined && board.groups.some((g) => g.id === args.id)) {
      return yield* $(err(groupIdConflict(args.boardId, args.id)));
    }
    let groupId = baseId;
    let attempt = 2;
    while (board.groups.some((g) => g.id === groupId)) {
      groupId = `${baseId}-${attempt++}`;
    }
    const group: BoardGroup = {
      id: groupId,
      name: args.name,
      ...(args.color !== undefined ? { color: args.color } : {}),
    };
    const next = { ...board, groups: [...board.groups, group] };
    await persistBoard(ctx.folder, args.boardId, next);
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { group };
  });
}

export interface UpdateGroupArgs {
  boardId: string;
  groupId: string;
  patch: {
    name?: string;
    /** Pass `null` to clear the color. */
    color?: string | null;
  };
}

export interface UpdateGroupResult {
  group: BoardGroup;
}

export async function updateGroup(
  ctx: MutationContext,
  args: UpdateGroupArgs,
): Promise<Result<UpdateGroupResult, MutationError>> {
  return DoAsync<UpdateGroupResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const idx = board.groups.findIndex((g) => g.id === args.groupId);
    if (idx === -1) return yield* $(err(groupNotFound(args.boardId, args.groupId)));
    const cur = board.groups[idx] as BoardGroup;
    const next: BoardGroup = { ...cur };
    if (args.patch.name !== undefined) next.name = args.patch.name;
    if (args.patch.color !== undefined) {
      if (args.patch.color === null) delete (next as { color?: string }).color;
      else next.color = args.patch.color;
    }
    const nextGroups = [...board.groups];
    nextGroups[idx] = next;
    await persistBoard(ctx.folder, args.boardId, { ...board, groups: nextGroups });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { group: next };
  });
}

export interface RemoveGroupArgs {
  boardId: string;
  groupId: string;
}

export interface RemoveGroupResult {
  removedGroupId: string;
  unaffectedFrameIds: string[];
}

export async function removeGroup(
  ctx: MutationContext,
  args: RemoveGroupArgs,
): Promise<Result<RemoveGroupResult, MutationError>> {
  return DoAsync<RemoveGroupResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const idx = board.groups.findIndex((g) => g.id === args.groupId);
    if (idx === -1) return yield* $(err(groupNotFound(args.boardId, args.groupId)));

    const affected: string[] = [];
    const nextFrames = board.frames.map((f) => {
      if (f.group === args.groupId) {
        affected.push(f.id);
        const { group: _g, ...rest } = f;
        return rest;
      }
      return f;
    });
    const nextGroups = board.groups.filter((g) => g.id !== args.groupId);

    await persistBoard(ctx.folder, args.boardId, {
      ...board,
      frames: nextFrames,
      groups: nextGroups,
    });
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return { removedGroupId: args.groupId, unaffectedFrameIds: affected };
  });
}
