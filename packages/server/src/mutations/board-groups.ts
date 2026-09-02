import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import type { BoardGroup, Config } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { badRequest, boardGroupNotFound, type MutationError } from "./errors.ts";
import { persistBoard, persistConfig } from "./persist.ts";
import { slugify } from "./slugify.ts";

/** Cap on group names — same order as a board name, but a sidebar header is shorter. */
const MAX_GROUP_NAME_LENGTH = 40;

/**
 * Colors handed to groups created without one, in order. Tailwind's 500s, far
 * enough apart to stay distinguishable as chips; the palette cycles when a
 * folder has more groups than colors.
 */
const GROUP_COLORS = [
  "#8b5cf6",
  "#0ea5e9",
  "#f59e0b",
  "#f43f5e",
  "#10b981",
  "#6366f1",
  "#ec4899",
  "#84cc16",
] as const;

function nextGroupColor(existing: readonly BoardGroup[]): string {
  const used = new Set(existing.map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) ?? (GROUP_COLORS[existing.length % 8] as string);
}

function boardGroups(config: Config): BoardGroup[] {
  return config.boardGroups ?? [];
}

function nameTooLong(name: string): MutationError | null {
  if (name.length <= MAX_GROUP_NAME_LENGTH) return null;
  return badRequest(
    `group name too long (${name.length} chars) — max ${MAX_GROUP_NAME_LENGTH} characters`,
  );
}

function uniqueGroupId(groups: readonly BoardGroup[], base: string): string {
  let id = base;
  let attempt = 2;
  while (groups.some((g) => g.id === id)) id = `${base}-${attempt++}`;
  return id;
}

/**
 * Resolve a group reference — an id, or a name — to a group id, creating the
 * group when nothing matches. That implicit create is the whole agent-facing
 * surface: `update_board { patch: { group: "Navigation" } }` files a board
 * without the agent first having to learn which groups exist. Matching is
 * case-insensitive on the name so "navigation" doesn't fork a second group.
 *
 * Returns the config to persist (unchanged when the group already existed).
 */
export function resolveGroup(
  config: Config,
  ref: string,
): Result<{ config: Config; groupId: string }, MutationError> {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return err(badRequest("group name is empty"));
  const tooLong = nameTooLong(trimmed);
  if (tooLong) return err(tooLong);
  const groups = boardGroups(config);
  const match =
    groups.find((g) => g.id === trimmed) ??
    groups.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return ok({ config, groupId: match.id });
  const group: BoardGroup = {
    id: uniqueGroupId(groups, slugify(trimmed, "group")),
    name: trimmed,
    color: nextGroupColor(groups),
  };
  return ok({ config: { ...config, boardGroups: [...groups, group] }, groupId: group.id });
}

export interface AddBoardGroupArgs {
  name: string;
  color?: string;
}

export interface AddBoardGroupResult {
  group: BoardGroup;
}

/**
 * Create an empty group. The canvas calls this from "New group…"; agents
 * never do — they name a group on a board and {@link resolveGroup} creates it.
 */
export async function addBoardGroup(
  ctx: MutationContext,
  args: AddBoardGroupArgs,
): Promise<Result<AddBoardGroupResult, MutationError>> {
  return DoAsync<AddBoardGroupResult, MutationError>(async function* () {
    const name = args.name.trim();
    if (name.length === 0) return yield* $(err(badRequest("group name is empty")));
    const tooLong = nameTooLong(name);
    if (tooLong) return yield* $(err(tooLong));
    const groups = boardGroups(ctx.folder.config);
    const group: BoardGroup = {
      id: uniqueGroupId(groups, slugify(name, "group")),
      name,
      color: args.color ?? nextGroupColor(groups),
    };
    await persistConfig(ctx.folder, { ...ctx.folder.config, boardGroups: [...groups, group] });
    ctx.broadcast({ type: "config-changed" });
    return { group };
  });
}

export interface UpdateBoardGroupArgs {
  groupId: string;
  patch: {
    name?: string;
    /** CSS color for the chip; null clears back to no explicit color. */
    color?: string | null;
  };
}

export interface UpdateBoardGroupResult {
  group: BoardGroup;
}

export async function updateBoardGroup(
  ctx: MutationContext,
  args: UpdateBoardGroupArgs,
): Promise<Result<UpdateBoardGroupResult, MutationError>> {
  return DoAsync<UpdateBoardGroupResult, MutationError>(async function* () {
    const groups = boardGroups(ctx.folder.config);
    const current = groups.find((g) => g.id === args.groupId);
    if (!current) return yield* $(err(boardGroupNotFound(args.groupId)));
    const next: BoardGroup = { ...current };
    if (args.patch.name !== undefined) {
      const name = args.patch.name.trim();
      if (name.length === 0) return yield* $(err(badRequest("group name is empty")));
      const tooLong = nameTooLong(name);
      if (tooLong) return yield* $(err(tooLong));
      next.name = name;
    }
    if (args.patch.color !== undefined) {
      if (args.patch.color === null) delete next.color;
      else next.color = args.patch.color;
    }
    await persistConfig(ctx.folder, {
      ...ctx.folder.config,
      boardGroups: groups.map((g) => (g.id === args.groupId ? next : g)),
    });
    ctx.broadcast({ type: "config-changed" });
    return { group: next };
  });
}

export interface RemoveBoardGroupArgs {
  groupId: string;
}

export interface RemoveBoardGroupResult {
  removedGroupId: string;
  /** Boards that were in the group and are now ungrouped. */
  ungroupedBoardIds: string[];
}

/**
 * Delete a group and un-file its boards. Deleting a group never deletes a
 * board — the boards move to Ungrouped, which is the only forgiving
 * interpretation of a one-click destructive-sounding action.
 */
export async function removeBoardGroup(
  ctx: MutationContext,
  args: RemoveBoardGroupArgs,
): Promise<Result<RemoveBoardGroupResult, MutationError>> {
  return DoAsync<RemoveBoardGroupResult, MutationError>(async function* () {
    const groups = boardGroups(ctx.folder.config);
    if (!groups.some((g) => g.id === args.groupId)) {
      return yield* $(err(boardGroupNotFound(args.groupId)));
    }
    const ungroupedBoardIds: string[] = [];
    for (const [boardId, board] of ctx.folder.boards) {
      if (board.group !== args.groupId) continue;
      const { group: _group, ...rest } = board;
      await persistBoard(ctx.folder, boardId, rest);
      ungroupedBoardIds.push(boardId);
    }
    const remaining = groups.filter((g) => g.id !== args.groupId);
    await persistConfig(ctx.folder, {
      ...ctx.folder.config,
      // Drop the field entirely once the last group goes, rather than
      // persisting an empty array — an ungrouped folder reads as one again.
      boardGroups: remaining.length > 0 ? remaining : undefined,
    });
    for (const boardId of ungroupedBoardIds) ctx.broadcast({ type: "board-changed", boardId });
    ctx.broadcast({ type: "config-changed" });
    return { removedGroupId: args.groupId, ungroupedBoardIds };
  });
}

export interface ReorderBoardGroupsArgs {
  /** Group ids in the desired sidebar order. */
  order: string[];
}

export interface ReorderBoardGroupsResult {
  order: string[];
}

/**
 * Set the sidebar order of groups. Unknown ids are ignored and omitted groups
 * keep their relative position at the end — same forgiving contract as
 * `reorder_boards`.
 */
export async function reorderBoardGroups(
  ctx: MutationContext,
  args: ReorderBoardGroupsArgs,
): Promise<Result<ReorderBoardGroupsResult, MutationError>> {
  const groups = boardGroups(ctx.folder.config);
  const seen = new Set<string>();
  const next: BoardGroup[] = [];
  for (const id of args.order) {
    const group = groups.find((g) => g.id === id);
    if (group && !seen.has(id)) {
      next.push(group);
      seen.add(id);
    }
  }
  for (const group of groups) if (!seen.has(group.id)) next.push(group);
  await persistConfig(ctx.folder, { ...ctx.folder.config, boardGroups: next });
  ctx.broadcast({ type: "config-changed" });
  return ok({ order: next.map((g) => g.id) });
}
