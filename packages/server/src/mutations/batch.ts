import { rm } from "node:fs/promises";
import { join } from "node:path";
import { err, type Result } from "@velloo/result";
import type { Annotation, Board, CanvasNote, Screen, Snippet } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import type { WatchEvent } from "../watcher.ts";
import { addNote } from "./api/annotations.ts";
import { addBoard } from "./api/boards.ts";
import { addFrame, addGroup, removeFrame, updateFrame } from "./api/frames.ts";
import { addScreen, removeScreen } from "./api/screens.ts";
import { addSnippet, instantiateSnippet, removeSnippet, updateSnippet } from "./api/snippets.ts";
import {
  addNode,
  moveNode,
  overrideSnippetProps,
  removeNode,
  setNodeId,
  updateProps,
  updatePropsBulk,
} from "./api/tree.ts";
import type { MutationContext } from "./context.ts";
import { badRequest, type MutationError } from "./errors.ts";
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

/**
 * Batch's update_props mirrors the standalone tool: `patches` for bulk,
 * `path` + `propPatch` for one node. Guarded here because batch
 * dispatches past the MCP layer's arg validation — without this, a
 * missing propPatch crashed with a raw `Object.entries` TypeError
 * (sample app dogfood, 2026-06-11).
 */
const updatePropsBatch: BatchFn = (ctx, args) => {
  const a = args as {
    screenId: string;
    path?: unknown;
    propPatch?: Record<string, unknown>;
    props?: Record<string, unknown>;
    patches?: unknown;
  };
  if (Array.isArray(a.patches)) {
    return updatePropsBulk(ctx, { screenId: a.screenId, patches: a.patches } as never);
  }
  // `props` is an accepted alias for `propPatch` (matches add_node's key).
  const propPatch = a.propPatch ?? a.props;
  if (a.path === undefined || propPatch === undefined) {
    return Promise.resolve(
      err(
        badRequest(
          "update_props: pass path + propPatch (single node) or patches: [{ path, propPatch }] (bulk).",
        ),
      ),
    );
  }
  return updateProps(ctx, { screenId: a.screenId, path: a.path, propPatch } as never);
};

/** add_node's `propPatch` is an accepted alias for `props` (matches update_props). */
const addNodeBatch: BatchFn = (ctx, args) => {
  const a = args as Record<string, unknown> & {
    props?: Record<string, unknown>;
    propPatch?: Record<string, unknown>;
  };
  return addNode(ctx, { ...a, props: a.props ?? a.propPatch } as never);
};

export const BATCH_TOOLS: Record<string, BatchFn> = {
  add_screen: addScreen as BatchFn,
  remove_screen: removeScreen as BatchFn,
  add_board: addBoard as BatchFn,
  add_frame: addFrame as BatchFn,
  remove_frame: removeFrame as BatchFn,
  add_group: addGroup as BatchFn,
  add_node: addNodeBatch,
  update_props: updatePropsBatch,
  override_snippet_props: overrideSnippetProps as BatchFn,
  remove_node: removeNode as BatchFn,
  move_node: moveNode as BatchFn,
  set_node_id: setNodeId as BatchFn,
  add_snippet: addSnippet as BatchFn,
  update_snippet: updateSnippet as BatchFn,
  remove_snippet: removeSnippet as BatchFn,
  instantiate_snippet: instantiateSnippet as BatchFn,
  update_frame: updateFrame as BatchFn,
  add_note: addNote as BatchFn,
};

type ResourceKind = "screen" | "board" | "snippet" | "notes" | "annotations";
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
    case "annotations":
      return join(folder.root, "screens", `${id}.annotations.json`);
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
    case "annotations":
      return folder.annotations.get(id);
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
    case "annotations":
      folder.annotations.set(id, value as Annotation[]);
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
    case "annotations":
      folder.annotations.delete(id);
      return;
  }
}

/** Resources a call mutates that already exist before it runs. */
function touchedResources(
  ctx: MutationContext,
  call: BatchCall,
): Array<{ kind: ResourceKind; id: string }> {
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
    case "remove_screen": {
      // Removal cascades: it drops the screen, its annotations sidecar, and
      // prunes referencing frames from every board — snapshot all of them so
      // a later rollback restores the full pre-batch state.
      const screenId = a.screenId as string;
      const touched: Array<{ kind: ResourceKind; id: string }> = [
        { kind: "screen", id: screenId },
        { kind: "annotations", id: screenId },
      ];
      for (const [boardId, board] of ctx.folder.boards) {
        if (board.frames.some((f) => f.screen === screenId))
          touched.push({ kind: "board", id: boardId });
      }
      return touched;
    }
    case "update_snippet":
    case "remove_snippet":
      return [{ kind: "snippet", id: a.snippetId as string }];
    case "add_frame":
    case "add_group":
    case "update_frame":
    case "remove_frame":
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
      // Sidecar files (notes, annotations) have no on-disk presence when empty.
      if (
        (snap.kind === "notes" || snap.kind === "annotations") &&
        Array.isArray(snap.value) &&
        snap.value.length === 0
      ) {
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
    if (atomic) for (const res of touchedResources(ctx, call)) snapshot(res.kind, res.id);
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
    } catch (thrown) {
      // An impl threw instead of returning a Result — almost always
      // malformed args (batch skips the MCP layer's schema validation).
      // Name the tool and point at the schema instead of leaking a bare
      // runtime error.
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      results.push({
        tool: call.tool,
        ok: false,
        error: {
          kind: "BadRequest",
          message: `batch ${call.tool}: invalid or missing args — match the standalone ${call.tool} tool's schema (${detail})`,
        },
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
