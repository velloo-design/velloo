import { type Board, deriveFlowSteps, type Frame } from "@velloo/schema";
import type { DesignFolder } from "./design-folder.ts";

/** One frame of the flow, resolved far enough to implement from. */
interface FlowFrameRef {
  frame: string;
  screen: string;
}

interface FlowSpecState extends FlowFrameRef {
  state: string;
  /** The condition, in the author's words. */
  when?: string;
  /** The state's frame this one follows, when it doesn't follow the default. */
  after?: string;
}

interface FlowSpecStep extends FlowFrameRef {
  name: string;
  /** The app path the step's screen stands for, when it has one. */
  route?: string;
  states?: FlowSpecState[];
}

interface FlowSpecGap {
  /** The step's frame id. */
  step: string;
  missing: string;
  why: string;
}

/**
 * A board read as a flow: what an agent implements from. Frame ids are the
 * handles (they are what `connect_frames` takes) and every frame carries its
 * screen, which is what `emit_code` takes.
 */
export interface FlowSpec {
  boardId: string;
  name: string;
  /** Steps that have a state or a transition, in board order. */
  steps: FlowSpecStep[];
  transitions: Array<{ from: string; to: string; when?: string }>;
  /** Steps nothing leads into, and steps that lead nowhere. */
  starts: string[];
  ends: string[];
  /** Frames no arrow touches, whose screen isn't in the flow at another size. */
  unconnected?: string[];
  gaps?: FlowSpecGap[];
}

/**
 * The one gap worth asserting without knowing the product: a step that waits
 * on something has to say what happens when the wait fails. Every other
 * "missing" state depends on what the step is — a welcome screen owes nobody
 * an empty state — so those are left for the reader to judge from `states`.
 */
function gapsOf(step: FlowSpecStep): FlowSpecGap[] {
  const states = new Set(step.states?.map((entry) => entry.state));
  if (states.has("loading") && !states.has("error")) {
    return [{ step: step.frame, missing: "error", why: "it has a loading state" }];
  }
  return [];
}

/**
 * Where a flow begins and where it finishes, for flows that are not a straight
 * line. "Nothing leads into it" stops answering as soon as a flow has a way
 * back — "edit email", "send a new link" — because then something leads into
 * every step, and the flow has no start at all.
 *
 * So steps that lead round to each other are taken together, as one loop. The
 * flow starts at a loop nothing outside leads into, and ends at one that leads
 * nowhere outside. Within a loop, the start is the step no other step enters at
 * its default frame, and the end the one that enters no other's — and when that
 * leaves none (a plain Back to the previous step's form), the step drawn first
 * and the step drawn last.
 */
function flowEnds(
  order: string[],
  onward: Map<string, Set<string>>,
  enteredAtDefault: Set<string>,
  leavesToDefault: Set<string>,
): { starts: string[]; ends: string[] } {
  const reach = new Map<string, Set<string>>();
  for (const step of order) {
    const seen = new Set<string>();
    const pending = [...(onward.get(step) ?? [])];
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
      if (seen.has(at)) continue;
      seen.add(at);
      pending.push(...(onward.get(at) ?? []));
    }
    reach.set(step, seen);
  }
  const reaches = (from: string, to: string) => reach.get(from)?.has(to) === true;
  const loopOf = (step: string) =>
    order.filter((other) => other === step || (reaches(step, other) && reaches(other, step)));

  const starts: string[] = [];
  const ends: string[] = [];
  const done = new Set<string>();
  for (const step of order) {
    if (done.has(step)) continue;
    const loop = loopOf(step);
    for (const member of loop) done.add(member);
    const outside = order.filter((other) => !loop.includes(other));
    if (!outside.some((other) => loop.some((member) => reaches(other, member)))) {
      const unentered = loop.filter((member) => !enteredAtDefault.has(member));
      starts.push(
        ...(loop.length === 1 || unentered.length === 0 ? [loop[0] as string] : unentered),
      );
    }
    if (!outside.some((other) => loop.some((member) => reaches(member, other)))) {
      const staying = loop.filter((member) => !leavesToDefault.has(member));
      ends.push(...(loop.length === 1 || staying.length === 0 ? [loop.at(-1) as string] : staying));
    }
  }
  return { starts, ends };
}

export function flowSpec(folder: DesignFolder, board: Board): FlowSpec {
  const frames = new Map<string, Frame>(board.frames.map((frame) => [frame.id, frame]));
  const { steps, transitions, stepOf } = deriveFlowSteps(board);

  // Only an arrow between two different steps moves the flow along; "Try
  // again" from a step's error state back to its form stays inside the step.
  const onward = new Map<string, Set<string>>();
  const enteredAtDefault = new Set<string>();
  const leavesToDefault = new Set<string>();
  const touched = new Set<string>();
  for (const edge of transitions) {
    const from = stepOf.get(edge.from) as string;
    const to = stepOf.get(edge.to) as string;
    touched.add(from).add(to);
    if (from === to) continue;
    const targets = onward.get(from);
    if (targets) targets.add(to);
    else onward.set(from, new Set([to]));
    // A step is entered at its default frame. An arrow that lands on one of
    // its states — "send a new link", back to "check your inbox" — returns to
    // the middle of it, which is how a way back differs from the way in.
    if (edge.to === to) {
      enteredAtDefault.add(to);
      leavesToDefault.add(from);
    }
  }

  const ref = (frameId: string): FlowFrameRef => ({
    frame: frameId,
    screen: (frames.get(frameId) as Frame).screen,
  });

  const connected: FlowSpecStep[] = [];
  const alone: Frame[] = [];
  for (const step of steps) {
    const frame = frames.get(step.frame) as Frame;
    if (step.states.length === 0 && !touched.has(step.frame)) {
      alone.push(frame);
      continue;
    }
    const screen = folder.screens.get(frame.screen);
    connected.push({
      ...ref(step.frame),
      name: frame.label ?? screen?.name ?? frame.screen,
      ...(screen?.route ? { route: screen.route } : {}),
      ...(step.states.length > 0
        ? {
            states: step.states.map((entry) => ({
              state: entry.state,
              ...ref(entry.frame),
              ...(entry.when !== undefined ? { when: entry.when } : {}),
              ...(entry.after !== undefined ? { after: entry.after } : {}),
            })),
          }
        : {}),
    });
  }

  // The same screen framed again at another viewport is that step at another
  // size, not a screen the flow forgot.
  const inFlow = new Set<string>();
  for (const step of connected) {
    inFlow.add(step.screen);
    for (const entry of step.states ?? []) inFlow.add(entry.screen);
  }
  const unconnected = alone.filter((frame) => !inFlow.has(frame.screen)).map((frame) => frame.id);
  const gaps = connected.flatMap(gapsOf);
  const order = connected.map((step) => step.frame);
  const { starts, ends } = flowEnds(order, onward, enteredAtDefault, leavesToDefault);

  return {
    boardId: board.id,
    name: board.name,
    steps: connected,
    transitions: transitions.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.label !== undefined ? { when: edge.label } : {}),
    })),
    starts,
    ends,
    ...(unconnected.length > 0 ? { unconnected } : {}),
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}
