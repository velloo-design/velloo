import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AddBoardBody,
  AddFrameBody,
  AddNodeBody,
  AddNoteBody,
  AddScreenBody,
  AddSnippetBody,
  InstantiateSnippetBody,
  MoveNodeBody,
  type Normalized,
  normalizeAddNode,
  normalizeUpdateFrame,
  normalizeUpdateProps,
  normalizeUpdateSnippetInstance,
  RemoveFrameBody,
  RemoveNodeBody,
  RemoveScreenBody,
  RemoveSnippetBody,
  SetNodeIdBody,
  SetScreenTreeBody,
  UpdateFrameBody,
  UpdatePropsBody,
  UpdateSnippetBody,
  UpdateSnippetInstanceBody,
  type WatchEvent,
} from "@velloo/protocol";
import type { Result } from "@velloo/result";
import type { Annotation, Board, CanvasNote, Screen, Snippet } from "@velloo/schema";
import type { z } from "zod";
import type { ActivityEvent } from "../activity.ts";
import type { DesignFolder } from "../design-folder.ts";
import { writeJsonAtomic } from "../fs.ts";
import { addNote } from "./api/annotations.ts";
import { addBoard } from "./api/boards.ts";
import { addFrame, removeFrame, updateFrame, updateFrames } from "./api/frames.ts";
import { addScreen, removeScreen, setScreenTree } from "./api/screens.ts";
import { addSnippet, instantiateSnippet, removeSnippet, updateSnippet } from "./api/snippets.ts";
import {
  addNode,
  moveNode,
  removeNode,
  setNodeId,
  updateProps,
  updatePropsBulk,
} from "./api/tree.ts";
import { type MutationContext, withBoardLock, withScreenLock, withSnippetLock } from "./context.ts";
import { badRequest, type MutationError } from "./errors.ts";
import { isSnippetTreeId, snippetIdFromTreeId } from "./lookup.ts";
import { updateSnippetInstance } from "./update-snippet-instance.ts";

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

/**
 * A validated, argument-bound call, ready to run against a context.
 *
 * `prepare` is the only way to reach a mutation through batch, which is the
 * point: batch used to type its dispatch table as `args: never` and cast every
 * entry with `as never`, so it accepted literally any object and handed it
 * straight to an impl. The same mutations were schema-validated over HTTP and
 * by their own MCP tools — batch alone skipped it, and the resulting crashes
 * (a missing `propPatch` reaching `Object.entries`, sample app dogfood 2026-06-11)
 * were patched one hand-written guard at a time. Each entry now carries the
 * shared schema from `@velloo/protocol` instead.
 */
type BatchPrepared =
  | { ok: true; run: (ctx: MutationContext) => Promise<Result<unknown, MutationError>> }
  | { ok: false; error: MutationError };

interface BatchTool {
  prepare(args: unknown): BatchPrepared;
}

/** Normalization for the mutations whose arguments need no reconciling. */
const asIs = <T>(args: T): Normalized<T> => ({ ok: true, args });

/**
 * Bind a schema, its normalization, and the impl into one entry. The generics
 * tie them together: a schema whose output stops matching its impl's arguments
 * fails to compile here rather than at a call site somewhere in a batch.
 */
function batchTool<S extends z.ZodTypeAny, A>(
  name: string,
  body: S,
  normalize: (input: z.output<S>) => Normalized<A>,
  run: (ctx: MutationContext, args: A) => Promise<Result<unknown, MutationError>>,
): BatchTool {
  return {
    prepare(rawArgs) {
      const parsed = body.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          ok: false,
          error: badRequest(
            `batch ${name}: invalid or missing args — match the standalone ${name} tool's schema.`,
            parsed.error.issues,
          ),
        };
      }
      const normalized = normalize(parsed.data);
      if (!normalized.ok) {
        return { ok: false, error: badRequest(normalized.message, normalized.issues) };
      }
      const args = normalized.args;
      return { ok: true, run: (ctx) => run(ctx, args) };
    },
  };
}

export const BATCH_TOOLS: Record<string, BatchTool> = {
  add_screen: batchTool("add_screen", AddScreenBody, asIs, addScreen),
  remove_screen: batchTool("remove_screen", RemoveScreenBody, asIs, removeScreen),
  set_screen_tree: batchTool("set_screen_tree", SetScreenTreeBody, asIs, setScreenTree),
  add_board: batchTool("add_board", AddBoardBody, asIs, addBoard),
  add_frame: batchTool("add_frame", AddFrameBody, asIs, addFrame),
  remove_frame: batchTool("remove_frame", RemoveFrameBody, asIs, removeFrame),
  add_node: batchTool("add_node", AddNodeBody, normalizeAddNode, addNode),
  update_props: batchTool("update_props", UpdatePropsBody, normalizeUpdateProps, (ctx, plan) =>
    plan.mode === "bulk" ? updatePropsBulk(ctx, plan.args) : updateProps(ctx, plan.args),
  ),
  remove_node: batchTool("remove_node", RemoveNodeBody, asIs, removeNode),
  move_node: batchTool("move_node", MoveNodeBody, asIs, moveNode),
  set_node_id: batchTool("set_node_id", SetNodeIdBody, asIs, setNodeId),
  add_snippet: batchTool("add_snippet", AddSnippetBody, asIs, addSnippet),
  update_snippet: batchTool("update_snippet", UpdateSnippetBody, asIs, updateSnippet),
  remove_snippet: batchTool("remove_snippet", RemoveSnippetBody, asIs, removeSnippet),
  instantiate_snippet: batchTool(
    "instantiate_snippet",
    InstantiateSnippetBody,
    asIs,
    instantiateSnippet,
  ),
  update_snippet_instance: batchTool(
    "update_snippet_instance",
    UpdateSnippetInstanceBody,
    normalizeUpdateSnippetInstance,
    updateSnippetInstance,
  ),
  update_frame: batchTool("update_frame", UpdateFrameBody, normalizeUpdateFrame, (ctx, plan) =>
    plan.mode === "bulk" ? updateFrames(ctx, plan.args) : updateFrame(ctx, plan.args),
  ),
  add_note: batchTool("add_note", AddNoteBody, asIs, addNote),
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
    case "set_screen_tree":
    case "update_snippet_instance":
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
  opts: { atomic?: boolean | undefined } = {},
): Promise<BatchResult> {
  const atomic = opts.atomic ?? true;
  const snapshots = new Map<ResourceKey, Snapshot>();
  const created: Array<{ kind: ResourceKind; id: string }> = [];
  const buffered: (WatchEvent | ActivityEvent)[] = [];
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

  // Restore one resource under its per-resource lock, so a concurrent canvas
  // mutation on the same screen/board/snippet can't interleave with the
  // rollback's file+memory writes (annotations lock on their screen id, notes
  // on their board id).
  function withResourceLock<T>(kind: ResourceKind, id: string, fn: () => Promise<T>): Promise<T> {
    switch (kind) {
      case "board":
      case "notes":
        return withBoardLock(ctx.folder, id, fn);
      case "snippet":
        return withSnippetLock(ctx.folder, id, fn);
      default:
        return withScreenLock(ctx.folder, id, fn);
    }
  }

  async function rollback(): Promise<void> {
    for (const res of created) {
      // A created resource that was also snapshotted pre-existed (the
      // create would have conflicted) — snapshot restore handles it.
      if (snapshots.has(`${res.kind}:${res.id}`)) continue;
      await withResourceLock(res.kind, res.id, async () => {
        deleteResourceMemory(ctx.folder, res.kind, res.id);
        await rm(resourceFile(ctx.folder, res.kind, res.id), { force: true });
      });
    }
    for (const snap of snapshots.values()) {
      await withResourceLock(snap.kind, snap.id, async () => {
        if (!snap.existed) {
          deleteResourceMemory(ctx.folder, snap.kind, snap.id);
          await rm(resourceFile(ctx.folder, snap.kind, snap.id), { force: true });
          return;
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
      });
    }
    ctx.folder.history.truncateUndoTo(undoDepth);
  }

  // Pre-flight: ≥2 numeric-path remove_node/move_node on the SAME screen is a footgun —
  // each removal shifts later siblings' indices, so subsequent numeric paths miss and the
  // whole atomic batch rolls back. Refuse upfront with an actionable message instead.
  const isIndexPath = (p: unknown): boolean =>
    Array.isArray(p) || (typeof p === "string" && p.trim().startsWith("["));
  const indexEdits = new Map<string, number>();
  for (const call of calls) {
    if (call.tool !== "remove_node" && call.tool !== "move_node") continue;
    const a = call.args as { screenId?: unknown; path?: unknown; fromPath?: unknown };
    const p = a.path ?? a.fromPath;
    if (typeof a.screenId === "string" && isIndexPath(p)) {
      indexEdits.set(a.screenId, (indexEdits.get(a.screenId) ?? 0) + 1);
    }
  }
  const footgun = [...indexEdits].find(([, n]) => n >= 2);
  if (footgun) {
    return {
      completed: 0,
      total: calls.length,
      rolledBack: atomic,
      results: [
        {
          tool: "batch",
          ok: false,
          error: badRequest(
            `batch: ${footgun[1]} remove_node/move_node calls on screen "${footgun[0]}" use numeric paths. Indices shift as earlier siblings are removed, so later paths miss and the batch rolls back. Give each target a stable @id (set_node_id) and address it as "@id", or order removals deepest-index-first.`,
          ),
        },
      ],
    };
  }

  const results: BatchCallResult[] = [];
  for (const call of calls) {
    const tool = BATCH_TOOLS[call.tool];
    if (!tool) {
      results.push({
        tool: call.tool,
        ok: false,
        error: badRequest(`batch: unsupported tool "${call.tool}"`),
      });
      break;
    }
    // Validate BEFORE snapshotting: a malformed call is now rejected without
    // touching the folder at all, rather than reaching an impl and throwing.
    const prepared = tool.prepare(call.args);
    if (!prepared.ok) {
      results.push({ tool: call.tool, ok: false, error: prepared.error });
      break;
    }
    if (atomic) for (const res of touchedResources(ctx, call)) snapshot(res.kind, res.id);
    const r = await prepared.run(stagedCtx);
    if (r.ok) {
      const made = createdResource(call, r.value);
      if (made) created.push(made);
      results.push({ tool: call.tool, ok: true, value: r.value });
    } else {
      results.push({ tool: call.tool, ok: false, error: r.error });
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
