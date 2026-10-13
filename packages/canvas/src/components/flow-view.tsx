import { type FlowEdge, liveFlowEdges } from "@velloo/schema";
import { type CSSProperties, Fragment, type ReactNode, useState } from "react";
import {
  type FlowBox,
  type FlowRoute,
  flowLabelT,
  flowPointAt,
  flowSpanPath,
  flowVisibleSpans,
  routeFlowEdges,
} from "../flow-geometry.ts";
import { Badge } from "./ui/badge.tsx";

/**
 * A board's flow arrows, drawn. **Store-free by contract**: everything here
 * takes what it draws as props, because two surfaces draw the same arrows —
 * the editing canvas (`FlowLayer`, which adds the editor, the grip and the
 * arrow being dragged out) and velloo-cloud's share viewer, which imports this
 * file by path and shows them read-only. A share has to look like the canvas,
 * and the only way two renderings stay the same is to be one.
 *
 * It must sit inside the board's pan/zoom element, which sets `--canvas-zoom`.
 */

/**
 * The board's coordinate space is scaled by the zoom; dividing by the same
 * variable holds a length to a constant size on screen. It is CSS, so a wheel
 * tick moves every arrow's weight, head and label without a re-render — the
 * same arrangement the frame chrome uses.
 */
export const flowPerZoom = (px: number): string => `calc(${px}px / var(--canvas-zoom, 1))`;
const COUNTER_SCALE = "scale(calc(1 / var(--canvas-zoom, 1)))";

/** How far short of a frame an arrow that passes behind it stops, in screen px. */
const CUT_GAP = 7;
/** Screen px between an arrow and the chip that labels it. */
const CHIP_GAP = 7;

/** Colour by what the arrow says. Any state without a convention reads as a plain state. */
const STATE_TONE: Record<string, string> = {
  loading: "text-amber-500",
  empty: "text-muted-foreground",
  error: "text-destructive",
  success: "text-emerald-500",
};
const toneOf = (edge: Pick<FlowEdge, "state">): string =>
  edge.state === undefined ? "text-foreground/60" : (STATE_TONE[edge.state] ?? "text-primary");

const flowEdgeKey = (edge: { from: string; to: string }): string => `${edge.from}→${edge.to}`;

interface FlowFrame {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where each frame's rendered screen sits on the board: the frame's origin
 * plus the measured header above it. Arrows attach to this box, not to the
 * frame's chrome. The header row is `inset.y` tall in layout and counter-scaled
 * against the zoom, so that is how much board it covers above the screen.
 */
export function flowFrameBoxes(
  frames: readonly FlowFrame[],
  insets: Readonly<Record<string, { x: number; y: number } | undefined>>,
  zoom: number,
): Array<FlowBox & { id: string }> {
  return frames.map((frame) => {
    const inset = insets[frame.id] ?? { x: 0, y: 0 };
    return {
      id: frame.id,
      x: frame.x + inset.x,
      y: frame.y + inset.y,
      w: frame.w,
      h: frame.h,
      head: inset.y / (zoom || 1),
    };
  });
}

/** One arrow, routed: its curve and the stretches of it that are in view. */
export interface RoutedFlowEdge {
  key: string;
  edge: FlowEdge;
  route: FlowRoute;
  spans: [number, number][];
}

function routeFlow(
  boxes: ReadonlyArray<FlowBox & { id: string }>,
  edges: readonly FlowEdge[],
  zoom: number,
): RoutedFlowEdge[] {
  // Routed together: arrows that share a side of a frame each get their own
  // place along it, so no two run on one line.
  const routes = routeFlowEdges(new Map(boxes.map((box) => [box.id, box])), edges);
  return edges.flatMap((edge, index) => {
    const route = routes[index];
    if (!route) return [];
    // An arrow is never drawn across a screen it isn't an arrow of: where it
    // would cross one it stops short of the frame and resumes on the far side.
    const covers = boxes.filter((box) => box.id !== edge.from && box.id !== edge.to);
    const spans = flowVisibleSpans(route, covers, CUT_GAP / (zoom || 1));
    return [{ key: flowEdgeKey(edge), edge, route, spans }];
  });
}

const WHOLE: [number, number][] = [[0, 1]];

interface FlowArrowStrokeProps {
  route: FlowRoute;
  /** The stretches of the arrow in view (see `flowVisibleSpans`); all of it by default. */
  spans?: readonly [number, number][];
  dashed: boolean;
  firm?: boolean;
}

/** The line, its cut bars and its head. Coloured by `currentColor`. */
export function FlowArrowStroke({
  route,
  spans = WHOLE,
  dashed,
  firm = false,
}: FlowArrowStrokeProps) {
  const line: CSSProperties = {
    strokeWidth: flowPerZoom(firm ? 2.25 : 1.5),
    ...(dashed ? { strokeDasharray: `${flowPerZoom(6)} ${flowPerZoom(5)}` } : {}),
  };
  // Where the arrow goes under a frame, and where it comes back out.
  const cuts = spans.flatMap(([from, to]) => [
    ...(from > 0 ? [from] : []),
    ...(to < 1 ? [to] : []),
  ]);
  const arrives = spans.at(-1)?.[1] === 1;
  return (
    <>
      {spans.map(([from, to]) => (
        <path
          key={from}
          d={flowSpanPath(route, from, to)}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          style={line}
        />
      ))}
      {cuts.map((t) => {
        const at = flowPointAt(route, t);
        return (
          // A bar across the line, just short of the frame: the arrow doesn't
          // end here, it passes behind. Heavier than the line it stops, so it
          // reads as a stop and not as part of the screen's edge.
          <path
            key={t}
            data-flow-cut
            d="M 0 -6 L 0 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              transform: `translate(${at.x}px, ${at.y}px) rotate(${at.angle}deg) ${COUNTER_SCALE}`,
            }}
          />
        );
      })}
      {arrives ? (
        <path
          d="M 0 0 L -10 -4.5 L -10 4.5 Z"
          fill="currentColor"
          style={{
            transform: `translate(${route.end.x}px, ${route.end.y}px) rotate(${route.angle}deg) ${COUNTER_SCALE}`,
          }}
        />
      ) : null}
    </>
  );
}

interface FlowArrowProps {
  routed: RoutedFlowEdge;
  near: boolean;
  onNear(key: string | null): void;
  onPick?: ((edge: FlowEdge) => void) | undefined;
}

function FlowArrow({ routed: { key, edge, route, spans }, near, onNear, onPick }: FlowArrowProps) {
  return (
    <g data-flow-edge={key} data-flow-state={edge.state ?? ""} className={toneOf(edge)}>
      <FlowArrowStroke route={route} spans={spans} dashed={edge.state !== undefined} firm={near} />
      {/* A hairline is no target: a wide invisible stroke takes the pointer —
          only where the arrow is in view, so it never takes a click meant for
          the screen it passes behind. */}
      {spans.map(([from, to]) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: the chip on the arrow is the keyboard path to the same editor.
        <path
          key={from}
          data-flow-hit
          d={flowSpanPath(route, from, to)}
          fill="none"
          stroke="transparent"
          style={{
            strokeWidth: flowPerZoom(14),
            pointerEvents: "stroke",
            ...(onPick ? { cursor: "pointer" } : {}),
          }}
          onPointerEnter={() => onNear(key)}
          onPointerLeave={() => onNear(null)}
          onClick={onPick ? () => onPick(edge) : undefined}
        />
      ))}
    </g>
  );
}

/**
 * Where a labelled chip sits relative to its point on the arrow: beside the
 * line, never on it. Frames are often placed closer together than a label is
 * wide, and a chip centred on a short arrow hides the whole of it — head
 * included, which is the one thing an arrow has to show. Above the arrow where
 * it runs level and to the right where it runs upright; an arrow that shares a
 * side of its frame with others takes the side its lane is on, so the labels
 * of two parallel arrows sit outside the pair rather than on each other.
 *
 * Written after the counter-scale, so the lengths are screen px.
 */
function chipLift(angle: number, lane: FlowRoute["lane"]): string {
  const radians = (angle * Math.PI) / 180;
  if (Math.abs(Math.cos(radians)) >= Math.abs(Math.sin(radians))) {
    return lane === 1
      ? `translate(0, calc(50% + ${CHIP_GAP}px))`
      : `translate(0, calc(-50% - ${CHIP_GAP}px))`;
  }
  return lane === -1
    ? `translate(calc(-50% - ${CHIP_GAP}px), 0)`
    : `translate(calc(50% + ${CHIP_GAP}px), 0)`;
}

interface FlowLabelAnchorProps {
  routed: RoutedFlowEdge;
  /** Where along the arrow, when something other than the edge says (a drag in progress). */
  at?: number | null | undefined;
  /** Sits on the line instead of beside it: an arrow with nothing to say shows a dot. */
  bare?: boolean;
  /** The pointer is on this label's arrow. */
  near: boolean;
  /** Held forward regardless: its editor is open, or it is being dragged. */
  forward?: boolean;
  onNear(key: string | null): void;
  children: ReactNode;
}

/**
 * A label's place on the board: at its point along the arrow, a constant size
 * at any zoom. It rests slightly see-through, so a label that has to sit near
 * a screen doesn't blank out what is under it, and comes fully forward when
 * the pointer is on it or on its arrow.
 */
export function FlowLabelAnchor({
  routed: { key, edge, route, spans },
  at,
  bare = false,
  near,
  forward = false,
  onNear,
  children,
}: FlowLabelAnchorProps) {
  const point = flowPointAt(route, at ?? edge.labelAt ?? flowLabelT(spans));
  return (
    <div
      data-flow-label={key}
      data-flow-near={near || forward ? "" : undefined}
      className="absolute opacity-70 transition-opacity data-[flow-near]:opacity-100"
      style={{
        left: point.x,
        top: point.y,
        transform: `translate(-50%, -50%) ${COUNTER_SCALE}${bare ? "" : ` ${chipLift(point.angle, route.lane)}`}`,
      }}
      onPointerEnter={() => onNear(key)}
      onPointerLeave={() => onNear(null)}
    >
      {children}
    </div>
  );
}

/** The pill a label is drawn in. */
export const FLOW_LABEL_PILL =
  "flex max-w-60 items-center rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5 text-xs text-foreground shadow-xs";

/** What an arrow says: its state, tinted, and its label. */
export function FlowLabelText({ edge }: { edge: FlowEdge }) {
  return (
    <>
      {edge.state !== undefined ? (
        <Badge variant="outline" className={`${toneOf(edge)} bg-background`}>
          {edge.state}
        </Badge>
      ) : null}
      {edge.label !== undefined ? (
        <span className={`truncate ${edge.state === undefined ? "pl-0.5" : ""}`}>{edge.label}</span>
      ) : null}
    </>
  );
}

interface FlowViewProps {
  /** The board's frames, where they are now (a frame mid-drag at its draft position). */
  frames: readonly FlowFrame[];
  /** Each frame's measured header: the screen's offset from the frame's origin. */
  insets: Readonly<Record<string, { x: number; y: number } | undefined>>;
  /** The board's zoom — for the header's height and the gap at a cut, which hold their size on screen. */
  zoom: number;
  edges: readonly FlowEdge[] | undefined;
  /** An arrow was clicked. Absent, arrows are not clickable. */
  onPick?: (edge: FlowEdge) => void;
  /**
   * Draw an arrow's label. Absent, labels are read-only pills, and an arrow
   * that says nothing has none.
   */
  label?: (args: {
    routed: RoutedFlowEdge;
    near: boolean;
    onNear(key: string | null): void;
  }) => ReactNode;
  /** More SVG drawn with the arrows: the one being dragged out of a frame. */
  overlay?: ReactNode;
}

/**
 * The arrows between a board's frames, in the frames' own coordinate space. A
 * solid arrow is a transition to another step; a dashed one, tinted by its
 * state, says the frame it points at is the same step in that state. Arrows
 * that share a side of a frame are spread along it, an arrow is cut where it
 * would cross another frame, and each carries its label beside it.
 */
export function FlowView({ frames, insets, zoom, edges, onPick, label, overlay }: FlowViewProps) {
  // The arrow the pointer is on or beside: its label comes forward and its
  // line firms up, which is also how a label is matched to its arrow.
  const [near, setNear] = useState<string | null>(null);
  const boxes = flowFrameBoxes(frames, insets, zoom);
  const routed = routeFlow(boxes, liveFlowEdges({ frames, edges: edges ? [...edges] : [] }), zoom);
  if (routed.length === 0 && !overlay) return null;

  return (
    <>
      <svg
        data-flow-layer
        aria-hidden="true"
        width="1"
        height="1"
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
      >
        {routed.map((arrow) => (
          <FlowArrow
            key={arrow.key}
            routed={arrow}
            near={near === arrow.key}
            onNear={setNear}
            onPick={onPick}
          />
        ))}
        {overlay}
      </svg>
      {routed.map((arrow) => {
        const isNear = near === arrow.key;
        if (label) {
          return (
            <Fragment key={arrow.key}>
              {label({ routed: arrow, near: isNear, onNear: setNear })}
            </Fragment>
          );
        }
        if (arrow.edge.label === undefined && arrow.edge.state === undefined) return null;
        return (
          <FlowLabelAnchor key={arrow.key} routed={arrow} near={isNear} onNear={setNear}>
            <div className={`${FLOW_LABEL_PILL} pl-2`}>
              <FlowLabelText edge={arrow.edge} />
            </div>
          </FlowLabelAnchor>
        );
      })}
    </>
  );
}
