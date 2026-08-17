import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Result } from "@velloo/result";
import type { Board, CanvasNote, Screen, Snippet } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import type { WatchEvent } from "../watcher.ts";
import { addNote } from "./api/annotations.ts";
import { addBoard } from "./api/boards.ts";
import { addFrame, addGroup, updateFrame } from "./api/frames.ts";
import { addScreen } from "./api/screens.ts";
import { addSnippet, instantiateSnippet } from "./api/snippets.ts";
import {
  addNode,
  moveNode,
  overrideSnippetProps,
  removeNode,
  setNodeId,
  updateProps,
} from "./api/tree.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";

/**
 * Transactional multi-mutation envelope.
 *
 * Atomicity, not isolation: each call persists as it runs (so the
 * watcher may briefly broadcast mid-batch state), but on the first
 * failure every touched resource is restored to its pre-batch bytes,
 * created resources are deleted, undo history is truncated back, and
 * no mutation-layer broadcasts are emitted. On success the buffered
 * broadcasts flush once.
 */
export interface BatchCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface BatchCallResult {
  tool: string;
  ok: boolean;
  value?: unknown;
  error?: unknown;
}

export interface BatchResult {
  completed: number;
  total: number;
  rolledBack: boolean;
  results: BatchCallResult[];
}

type BatchFn = (ctx: MutationContext, args: never) => Promise<Result<unknown, MutationError>>;

export const BATCH_TOOLS: Record<string, BatchFn> = {
  add_screen: addScreen as BatchFn,
  add_board: addBoard as BatchFn,
  add_frame: addFrame as BatchFn,
  add_group: addGroup as BatchFn,
  add_node: addNode as BatchFn,
  update_props: updateProps as BatchFn,
  override_snippet_props: overrideSnippetProps as BatchFn,
  remove_node: removeNode as BatchFn,
  move_node: moveNode as BatchFn,
  set_node_id: setNodeId as BatchFn,
  add_snippet: addSnippet as BatchFn,
  instantiate_snippet: instantiateSnippet as BatchFn,
  update_frame: updateFrame as BatchFn,
  add_note: addNote as BatchFn,
};

type ResourceKind = "screen" | "board" | "snippet" | "notes";
type ResourceKey = `${ResourceKind}:${string}`;

interface Snapshot {
  kind: ResourceKind;
  id: string;
  existed: boolean;
  value: unknown;
}

function resourceFile(folder: DesignFolder, kind: ResourceKind, id: string): string {
  switch (kind) {
    case "screen":
      return join(folder.root, "screens", `${id}.json`);
    case "board":
      return join(folder.root, "boards", `${id}.json`);
    case "snippet":
      return join(folder.root, "snippets", `${id}.json`);
    case "notes":
      return join(folder.root, "boards", `${id}.notes.json`);
  }
}

function readResource(folder: DesignFolder, kind: ResourceKind, id: string): unknown {
  switch (kind) {
    case "screen":
      return folder.screens.get(id);
    case "board":
      return folder.boards.get(id);
    case "snippet":
      return folder.snippets.get(id);
    case "notes":
      return folder.notes.get(id);
  }
}

function writeResourceMemory(
  folder: DesignFolder,
  kind: ResourceKind,
  id: string,
  value: unknown,
): void {
  switch (kind) {
    case "screen":
      folder.screens.set(id, value as Screen);
      return;
    case "board":
      folder.boards.set(id, value as Board);
      return;
    case "snippet":
      folder.snippets.set(id, value as Snippet);
      return;
    case "notes":
      folder.notes.set(id, value as CanvasNote[]);
      return;
  }
}

function deleteResourceMemory(folder: DesignFolder, kind: ResourceKind, id: string): void {
  switch (kind) {
    case "screen":
      folder.screens.delete(id);
      folder.annotations.delete(id);
      return;
    case "board":
      folder.boards.delete(id);
      folder.notes.delete(id);
      return;
    case "snippet":
      folder.snippets.delete(id);
      return;
    case "notes":
      folder.notes.delete(id);
      return;
  }
}

/** Resources a call mutates that already exist before it runs. */
function touchedResources(call: BatchCall): Array<{ kind: ResourceKind; id: string }> {
  const a = call.args;
  switch (call.tool) {
    case "add_node":
    case "update_props":
    case "remove_node":
    case "move_node":
    case "set_node_id":
    case "override_snippet_props":
    case "instantiate_snippet": {
      const screenId = a.screenId as string;
      // Snippet bodies are edited through virtual `snippet:<id>` screens.
      if (isSnippetTreeId(screenId))
        return [{ kind: "snippet", id: snippetIdFromTreeId(screenId) }];
      return [{ kind: "screen", id: screenId }];
    }
    case "add_frame":
    case "add_group":
    case "update_frame":
      return [{ kind: "board", id: a.boardId as string }];
    case "add_note":
      return [{ kind: "notes", id: a.boardId as string }];
    default:
      return []; // creates — tracked from results
  }
}

/** Resource a successful create-call produced (for delete-on-rollback). */
function createdResource(
  call: BatchCall,
  value: unknown,
): { kind: ResourceKind; id: string } | null {
  const v = value as Record<string, unknown>;
  switch (call.tool) {
    case "add_screen":
      return { kind: "screen", id: v.screenId as string };
    case "add_board":
      return { kind: "board", id: v.boardId as string };
    case "add_snippet":
      return { kind: "snippet", id: v.snippetId as string };
    default:
      return null;
  }
}

export async function runBatch(
  ctx: MutationContext,
  calls: BatchCall[],
  opts: { atomic?: boolean } = {},
): Promise<BatchResult> {
  const atomic = opts.atomic ?? true;
  const snapshots = new Map<ResourceKey, Snapshot>();
  const created: Array<{ kind: ResourceKind; id: string }> = [];
  const buffered: WatchEvent[] = [];
  const undoDepth = ctx.folder.history.depths().undo;

  const stagedCtx: MutationContext = atomic ? { ...ctx, broadcast: (e) => buffered.push(e) } : ctx;

  function snapshot(kind: ResourceKind, id: string): void {
    const key: ResourceKey = `${kind}:${id}`;
    if (snapshots.has(key)) return;
    const value = readResource(ctx.folder, kind, id);
    snapshots.set(key, {
      kind,
      id,
      existed: value !== undefined,
      value: value === undefined ? undefined : structuredClone(value),
    });
  }

  async function rollback(): Promise<void> {
    for (const res of created) {
      // A created resource that was also snapshotted pre-existed (the
      // create would have conflicted) — snapshot restore handles it.
      if (snapshots.has(`${res.kind}:${res.id}`)) continue;
      deleteResourceMemory(ctx.folder, res.kind, res.id);
      await rm(resourceFile(ctx.folder, res.kind, res.id), { force: true });
    }
    for (const snap of snapshots.values()) {
      if (!snap.existed) {
        deleteResourceMemory(ctx.folder, snap.kind, snap.id);
        await rm(resourceFile(ctx.folder, snap.kind, snap.id), { force: true });
        continue;
      }
      writeResourceMemory(ctx.folder, snap.kind, snap.id, structuredClone(snap.value));
      if (snap.kind === "notes" && Array.isArray(snap.value) && snap.value.length === 0) {
        await rm(resourceFile(ctx.folder, snap.kind, snap.id), { force: true });
      } else {
        await writeJsonAtomic(resourceFile(ctx.folder, snap.kind, snap.id), snap.value);
      }
    }
    ctx.folder.history.truncateUndoTo(undoDepth);
  }

  const results: BatchCallResult[] = [];
  for (const call of calls) {
    const fn = BATCH_TOOLS[call.tool];
    if (!fn) {
      results.push({
        tool: call.tool,
        ok: false,
        error: { kind: "BadRequest", message: `batch: unsupported tool "${call.tool}"` },
      });
      break;
    }
    if (atomic) for (const res of touchedResources(call)) snapshot(res.kind, res.id);
    try {
      const r = await fn(stagedCtx, call.args as never);
      if (r.ok) {
        const made = createdResource(call, r.value);
        if (made) created.push(made);
        results.push({ tool: call.tool, ok: true, value: r.value });
      } else {
        results.push({ tool: call.tool, ok: false, error: r.error });
        break;
      }
    } catch (err) {
      results.push({
        tool: call.tool,
        ok: false,
        error: { kind: "BadRequest", message: err instanceof Error ? err.message : String(err) },
      });
      break;
    }
  }

  const failed = results.some((r) => !r.ok);
  if (failed && atomic) {
    await rollback();
  } else if (atomic) {
    for (const e of buffered) ctx.broadcast(e);
  }

  return {
    completed: results.filter((r) => r.ok).length,
    total: calls.length,
    rolledBack: failed && atomic,
    results,
  };
}
