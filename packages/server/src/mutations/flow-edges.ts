import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import {
  type Board,
  DEFAULT_FLOW_STATE,
  type FlowEdge,
  flowEdgeProblem,
  liveFlowEdges,
  restatedStateArrows,
} from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { badRequest, frameNotFound, type MutationError } from "./errors.ts";
import { getBoard } from "./lookup.ts";
import { persistBoard } from "./persist.ts";

/**
 * Caps on what an arrow says, enforced here rather than in the on-disk schema
 * so a hand-written file with a longer one still loads. A label is a trigger
 * or a condition, read at a glance on the canvas; anything longer is a note.
 */
const MAX_LABEL_LENGTH = 120;
const MAX_STATE_LENGTH = 32;

interface FlowEdgeEntry {
  from: string;
  to: string;
  /** null clears; omitted leaves an existing arrow's label alone. */
  label?: string | null | undefined;
  /** null turns a state arrow back into a transition. */
  state?: string | null | undefined;
  remove?: boolean | undefined;
}

export interface ConnectFramesArgs {
  boardId: string;
  edges: FlowEdgeEntry[];
}

export interface ConnectFramesResult {
  /** Every arrow on the board after the write. */
  edges: FlowEdge[];
  /**
   * Arrows sent with a `state` their target already had in the same step,
   * kept as the transitions they are. Named so the writer knows what was read.
   */
  readAsTransitions?: Array<{ from: string; to: string; state: string }>;
}

function cleanLabel(
  label: string | null | undefined,
): Result<string | null | undefined, MutationError> {
  if (label === undefined || label === null) return ok(label);
  const trimmed = label.trim();
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return err(
      badRequest(
        `arrow label too long (${trimmed.length} chars) — max ${MAX_LABEL_LENGTH}; put the detail in a note`,
      ),
    );
  }
  return ok(trimmed.length > 0 ? trimmed : null);
}

function cleanState(
  state: string | null | undefined,
): Result<string | null | undefined, MutationError> {
  if (state === undefined || state === null) return ok(state);
  // Lower-cased so "Error" and "error" are one state to every reader.
  const trimmed = state.trim().toLowerCase();
  if (trimmed.length === 0) return ok(null);
  if (trimmed.length > MAX_STATE_LENGTH) {
    return err(badRequest(`state name too long — max ${MAX_STATE_LENGTH} characters`));
  }
  if (trimmed === DEFAULT_FLOW_STATE) {
    return err(
      badRequest(
        `"${DEFAULT_FLOW_STATE}" is the frame a step's state arrows start from, not a state to point at — draw the arrow from the default frame to its loading/empty/error/success frame.`,
      ),
    );
  }
  return ok(trimmed);
}

function patched(edge: FlowEdge, key: "label" | "state", value: string | null | undefined) {
  if (value === undefined) return edge;
  const { [key]: _dropped, ...rest } = edge;
  return value === null ? rest : { ...rest, [key]: value };
}

/**
 * Draw, edit and erase arrows in one write. Entries apply in order against the
 * arrows already there, and the result is checked as a whole — so one call can
 * re-point a state (erase one arrow, draw another) without tripping over the
 * intermediate shape.
 */
export async function connectFrames(
  ctx: MutationContext,
  args: ConnectFramesArgs,
): Promise<Result<ConnectFramesResult, MutationError>> {
  return DoAsync<ConnectFramesResult, MutationError>(async function* () {
    const board = yield* $(getBoard(ctx, args.boardId));
    const frames = new Set(board.frames.map((frame) => frame.id));
    let edges = liveFlowEdges(board);

    for (const entry of args.edges) {
      for (const end of [entry.from, entry.to]) {
        if (!frames.has(end)) return yield* $(err(frameNotFound(args.boardId, end)));
      }
      const at = edges.findIndex((edge) => edge.from === entry.from && edge.to === entry.to);
      if (entry.remove) {
        if (at === -1) {
          return yield* $(
            err(badRequest(`No arrow from "${entry.from}" to "${entry.to}" to remove.`)),
          );
        }
        edges = edges.filter((_, index) => index !== at);
        continue;
      }
      const label = yield* $(cleanLabel(entry.label));
      const state = yield* $(cleanState(entry.state));
      const base: FlowEdge = edges[at] ?? { from: entry.from, to: entry.to };
      const next = patched(patched(base, "label", label), "state", state);
      edges =
        at === -1 ? [...edges, next] : edges.map((edge, index) => (index === at ? next : edge));
    }

    // An arrow into a frame that is already that state of the same step says
    // nothing a transition doesn't; keep it as one rather than refuse it.
    const restated = restatedStateArrows({ frames: board.frames, edges });
    if (restated.length > 0) {
      edges = edges.map((edge) => (restated.includes(edge) ? patched(edge, "state", null) : edge));
    }

    const problem = flowEdgeProblem({ frames: board.frames, edges });
    if (problem) return yield* $(err(badRequest(`Can't draw that flow: ${problem}.`)));

    const { edges: _previous, ...rest } = board;
    const next: Board = edges.length > 0 ? { ...rest, edges } : rest;
    await persistBoard(ctx.folder, args.boardId, next);
    ctx.broadcast({ type: "board-changed", boardId: args.boardId });
    return {
      edges,
      ...(restated.length > 0
        ? {
            readAsTransitions: restated.map((edge) => ({
              from: edge.from,
              to: edge.to,
              state: edge.state as string,
            })),
          }
        : {}),
    };
  });
}
