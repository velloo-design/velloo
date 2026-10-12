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

export function flowSpec(folder: DesignFolder, board: Board): FlowSpec {
  const frames = new Map<string, Frame>(board.frames.map((frame) => [frame.id, frame]));
  const { steps, transitions, stepOf } = deriveFlowSteps(board);

  // Only an arrow between two different steps moves the flow along; "Try
  // again" from a step's error state back to its form stays inside the step.
  const leaves = new Set<string>();
  const entered = new Set<string>();
  const touched = new Set<string>();
  for (const edge of transitions) {
    const from = stepOf.get(edge.from) as string;
    const to = stepOf.get(edge.to) as string;
    touched.add(from).add(to);
    if (from === to) continue;
    leaves.add(from);
    entered.add(to);
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

  return {
    boardId: board.id,
    name: board.name,
    steps: connected,
    transitions: transitions.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.label !== undefined ? { when: edge.label } : {}),
    })),
    starts: connected.filter((step) => !entered.has(step.frame)).map((step) => step.frame),
    ends: connected.filter((step) => !leaves.has(step.frame)).map((step) => step.frame),
    ...(unconnected.length > 0 ? { unconnected } : {}),
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}
