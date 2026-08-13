import { $, DoAsync, err, type Result } from "@velloo/result";
import type { BoardGroup } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { groupIdConflict, groupNotFound, type MutationError } from "./errors.ts";
import { persistBoard } from "./persist.ts";

export interface AddGroupArgs {
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
    const baseId = args.id ?? slugify(args.name);
    if (args.id !== undefined && ctx.folder.board.groups.some((g) => g.id === args.id)) {
      return yield* $(err(groupIdConflict(args.id)));
    }
    let groupId = baseId;
    let attempt = 2;
    while (ctx.folder.board.groups.some((g) => g.id === groupId)) {
      groupId = `${baseId}-${attempt++}`;
    }
    const group: BoardGroup = {
      id: groupId,
      name: args.name,
      ...(args.color !== undefined ? { color: args.color } : {}),
    };
    const nextBoard = {
      ...ctx.folder.board,
      groups: [...ctx.folder.board.groups, group],
    };
    await persistBoard(ctx.folder, nextBoard);
    ctx.broadcast({ type: "board-changed" });
    return { group };
  });
}

export interface UpdateGroupArgs {
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
    const idx = ctx.folder.board.groups.findIndex((g) => g.id === args.groupId);
    if (idx === -1) return yield* $(err(groupNotFound(args.groupId)));
    const cur = ctx.folder.board.groups[idx] as BoardGroup;
    const next: BoardGroup = { ...cur };
    if (args.patch.name !== undefined) next.name = args.patch.name;
    if (args.patch.color !== undefined) {
      if (args.patch.color === null) {
        const { color: _c, ...rest } = next;
        Object.assign(next, rest);
        delete (next as { color?: string }).color;
      } else next.color = args.patch.color;
    }
    const nextGroups = [...ctx.folder.board.groups];
    nextGroups[idx] = next;
    await persistBoard(ctx.folder, { ...ctx.folder.board, groups: nextGroups });
    ctx.broadcast({ type: "board-changed" });
    return { group: next };
  });
}

export interface RemoveGroupArgs {
  groupId: string;
}

export interface RemoveGroupResult {
  removedGroupId: string;
  /** Frames whose `group` field was cleared. */
  unaffectedFrameIds: string[];
}

/**
 * Remove a group from the board. Frames in the group are *not* deleted —
 * they're un-grouped.
 */
export async function removeGroup(
  ctx: MutationContext,
  args: RemoveGroupArgs,
): Promise<Result<RemoveGroupResult, MutationError>> {
  return DoAsync<RemoveGroupResult, MutationError>(async function* () {
    const idx = ctx.folder.board.groups.findIndex((g) => g.id === args.groupId);
    if (idx === -1) return yield* $(err(groupNotFound(args.groupId)));

    const affected: string[] = [];
    const nextFrames = ctx.folder.board.frames.map((f) => {
      if (f.group === args.groupId) {
        affected.push(f.id);
        const { group: _g, ...rest } = f;
        return rest;
      }
      return f;
    });
    const nextGroups = ctx.folder.board.groups.filter((g) => g.id !== args.groupId);

    await persistBoard(ctx.folder, { frames: nextFrames, groups: nextGroups });
    ctx.broadcast({ type: "board-changed" });
    return { removedGroupId: args.groupId, unaffectedFrameIds: affected };
  });
}
