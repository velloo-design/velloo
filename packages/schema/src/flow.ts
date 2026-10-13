import { z } from "zod";

/**
 * An arrow between two frames of one board — what makes a board readable as a
 * flow. It is a spec, not behaviour: nothing here runs, and nothing here emits.
 *
 * One arrow says one of two things, and `state` is what tells them apart:
 *
 *  - **A transition** (no `state`): from this step, `label` happens, and the
 *    user is on `to`.
 *  - **A state** (`state` set): `to` shows the *same step* as `from`, in that
 *    state — its loading, empty or error version — and `label` is when.
 *
 * Different layouts are separate screens, so the states of a step are separate
 * frames; the arrows between them are what groups them into one step, which is
 * why a frame carries no state of its own (see {@link deriveFlowSteps}).
 *
 * An arrow has no id: a board holds at most one per ordered pair of frames, so
 * the pair is the identity.
 */
export const FlowEdgeSchema = z.object({
  /** Frame id the arrow leaves. */
  from: z.string().min(1),
  /** Frame id the arrow points at. */
  to: z.string().min(1),
  /** The trigger or condition, in plain words ("Submit", "Email already taken"). */
  label: z.string().min(1).optional(),
  /** Present ⇒ `to` is `from`'s step in this state. Free text; see {@link FLOW_STATES}. */
  state: z.string().min(1).optional(),
  /**
   * Where along the arrow its label sits, from 0 at the frame it leaves to 1
   * at the one it reaches. Set when someone slides the label out of the way;
   * absent, the canvas puts it mid-way along the part of the arrow in view.
   * Layout only: no reader of the flow looks at it.
   */
  labelAt: z.number().min(0).max(1).optional(),
});

export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

/**
 * The states a step conventionally has besides its default one. A vocabulary to
 * offer, not a constraint: `state` stays free text on disk so "offline" or
 * "expired" need no schema change.
 */
export const FLOW_STATES = ["loading", "empty", "error", "success"] as const;

/** What the frame a step's state arrows start from is called. Never stored. */
export const DEFAULT_FLOW_STATE = "default";

interface FlowBoard {
  frames: ReadonlyArray<{ id: string }>;
  edges?: FlowEdge[] | undefined;
}

/**
 * The arrows whose two ends are both still frames on the board. Reading goes
 * through this so a hand-edited or half-synced file draws what it can instead
 * of failing, and writing goes through it so removing a frame takes its arrows
 * with it wherever the removal happened.
 */
export function liveFlowEdges(board: FlowBoard): FlowEdge[] {
  if (!board.edges || board.edges.length === 0) return [];
  const frames = new Set(board.frames.map((frame) => frame.id));
  return board.edges.filter(
    (edge) => edge.from !== edge.to && frames.has(edge.from) && frames.has(edge.to),
  );
}

/** One frame of a step other than its default one. */
interface FlowStepState {
  frame: string;
  state: string;
  /** The arrow's label: when the step is in this state. */
  when?: string;
  /**
   * The state this one follows, when its arrow leaves another state rather
   * than the step's default frame: loading → error is "it was sent, then it
   * failed", and without this the read would say only that both exist.
   */
  after?: string;
}

/**
 * A step of the flow: the frame its state arrows start from, plus the frames
 * those arrows reach.
 */
export interface FlowStep {
  /** The default state's frame. Its id stands for the step. */
  frame: string;
  states: FlowStepState[];
}

export interface FlowSteps {
  /** Every frame belongs to exactly one step; a frame with no state arrows is a step alone. */
  steps: FlowStep[];
  /** Arrows that move between steps, endpoints as drawn (possibly a state's frame). */
  transitions: FlowEdge[];
  /** Frame id → the frame that stands for its step. */
  stepOf: Map<string, string>;
}

/**
 * Group a board's frames into steps by following its state arrows.
 *
 * A step is a tree: the default frame at the root, a state arrow down to each
 * state, and onward from there (loading → error is "it loaded, then failed").
 * Writes keep that shape — one state arrow into a frame, no cycles — but this
 * reads whatever is on disk, so a state arrow that would break the tree is
 * handed back as a transition rather than trusted.
 */
export function deriveFlowSteps(board: FlowBoard): FlowSteps {
  const parent = new Map<string, FlowEdge>();
  const transitions: FlowEdge[] = [];
  for (const edge of liveFlowEdges(board)) {
    if (edge.state === undefined || parent.has(edge.to) || reaches(parent, edge.from, edge.to)) {
      transitions.push(edge);
    } else {
      parent.set(edge.to, edge);
    }
  }

  const children = new Map<string, FlowEdge[]>();
  for (const edge of parent.values()) {
    const siblings = children.get(edge.from);
    if (siblings) siblings.push(edge);
    else children.set(edge.from, [edge]);
  }

  const steps: FlowStep[] = [];
  const stepOf = new Map<string, string>();
  for (const { id } of board.frames) {
    if (parent.has(id)) continue;
    const states: FlowStepState[] = [];
    stepOf.set(id, id);
    const pending = [...(children.get(id) ?? [])].reverse();
    for (let edge = pending.pop(); edge; edge = pending.pop()) {
      stepOf.set(edge.to, id);
      states.push({
        frame: edge.to,
        state: edge.state as string,
        ...(edge.label !== undefined ? { when: edge.label } : {}),
        ...(edge.from !== id ? { after: edge.from } : {}),
      });
      pending.push(...[...(children.get(edge.to) ?? [])].reverse());
    }
    steps.push({ frame: id, states });
  }
  return { steps, transitions, stepOf };
}

/** Whether walking state arrows up from `start` arrives at `target`. */
function reaches(parent: Map<string, FlowEdge>, start: string, target: string): boolean {
  for (let at: string | undefined = start; at !== undefined; at = parent.get(at)?.from) {
    if (at === target) return true;
  }
  return false;
}

/**
 * State arrows that can only be transitions inside their step. Anyone who
 * reads `state` as "what the arrow arrives at" draws these, and none of them
 * contradicts anything — so a writer keeps each as the transition it is
 * instead of refusing it:
 *
 *  - **a way back**: from a state to the frame it came from, or to the step's
 *    default ("fix the fields and resubmit", tagged `recovery`). Taken as a
 *    state it would make the step's default a state of its own state.
 *  - **a state restated**: into a frame that is already that state of the same
 *    step ("try again", arriving at `loading` a second time).
 *  - **`default`**: the frame a step's states start from is not one of them.
 *
 * A *different* state for a frame that has one, or the same state claimed by
 * another step, is a real contradiction and is left for the writer to refuse.
 */
export function transitionsDrawnAsStates(board: FlowBoard): FlowEdge[] {
  const parent = new Map<string, FlowEdge>();
  const drawn = new Set<FlowEdge>();
  const second: FlowEdge[] = [];
  const edges = liveFlowEdges(board);
  for (const edge of edges) {
    if (edge.state === undefined) continue;
    if (edge.state === DEFAULT_FLOW_STATE || reaches(parent, edge.from, edge.to)) drawn.add(edge);
    else if (parent.has(edge.to)) second.push(edge);
    else parent.set(edge.to, edge);
  }
  // Which step a frame is in is only known once every arrow has been read:
  // the one that puts `from` in the step may come after the one being judged.
  const stepOf = (frame: string): string => {
    let at = frame;
    for (let up = parent.get(at); up; up = parent.get(at)) at = up.from;
    return at;
  };
  for (const edge of second) {
    if (parent.get(edge.to)?.state === edge.state && stepOf(edge.from) === stepOf(edge.to)) {
      drawn.add(edge);
    }
  }
  return edges.filter((edge) => drawn.has(edge));
}

/**
 * Why a set of arrows can't be a board's flow, or null when it can. The one
 * rule set shared by every writer, so a board never holds arrows
 * {@link deriveFlowSteps} would have to reinterpret.
 */
export function flowEdgeProblem(board: FlowBoard): string | null {
  const frames = new Set(board.frames.map((frame) => frame.id));
  const pairs = new Set<string>();
  const parent = new Map<string, FlowEdge>();
  for (const edge of board.edges ?? []) {
    for (const end of [edge.from, edge.to]) {
      if (!frames.has(end)) return `no frame "${end}" on this board`;
    }
    if (edge.from === edge.to) return `"${edge.from}" can't point at itself`;
    const pair = `${edge.from}\u0000${edge.to}`;
    if (pairs.has(pair)) return `two arrows from "${edge.from}" to "${edge.to}"`;
    pairs.add(pair);
    if (edge.state === undefined) continue;
    const other = parent.get(edge.to);
    if (other) {
      return `"${edge.to}" is already the ${other.state} state of "${other.from}" — a frame is one state of one step`;
    }
    if (reaches(parent, edge.from, edge.to)) {
      return `"${edge.to}" → "${edge.from}" → "${edge.to}" loops — a step's states need one default frame to start from`;
    }
    parent.set(edge.to, edge);
  }
  return null;
}
