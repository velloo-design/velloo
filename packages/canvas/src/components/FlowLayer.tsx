import { FLOW_STATES, type FlowEdge, liveFlowEdges } from "@velloo/schema";
import { GripVertical, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";
import {
  type FlowRoute,
  flowFrameAt,
  flowLabelT,
  flowNearestT,
  flowPointAt,
  flowSpanPath,
  flowVisibleSpans,
  routeFlowDraft,
  routeFlowEdges,
} from "../flow-geometry.ts";
import { type FlowEdgeRef, flowBoxes, sameFlowEdge } from "../store/flow.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

/**
 * The board's coordinate space is scaled by the zoom; dividing by the same
 * variable holds a length to a constant size on screen. It is CSS, so a wheel
 * tick moves every arrow's weight, head and label without this layer
 * re-rendering — the same arrangement the frame chrome uses.
 */
const perZoom = (px: number): string => `calc(${px}px / var(--canvas-zoom, 1))`;
const COUNTER_SCALE = "scale(calc(1 / var(--canvas-zoom, 1)))";

/** How far outside a frame's edge a dropped arrow still lands on it, in screen px. */
export const FLOW_DROP_REACH = 16;

/**
 * A pointer's position on the board. `world` is the board's
 * `translate(pan) scale(zoom)` element, so its on-screen corner is the board's
 * origin and the zoom is the only divisor.
 */
export function boardPointOf(
  world: HTMLElement,
  event: { clientX: number; clientY: number },
): { x: number; y: number } {
  const origin = world.getBoundingClientRect();
  const zoom = useCanvas.getState().canvasZoom || 1;
  return { x: (event.clientX - origin.left) / zoom, y: (event.clientY - origin.top) / zoom };
}

/** A label can be slid nearly to either end of its arrow, never onto the frame's edge. */
const LABEL_T = { min: 0.06, max: 0.94 };

/** Colour by what the arrow says. Any state without a convention reads as a plain state. */
const STATE_TONE: Record<string, string> = {
  loading: "text-amber-500",
  empty: "text-muted-foreground",
  error: "text-destructive",
  success: "text-emerald-500",
};
const toneOf = (edge: Pick<FlowEdge, "state">): string =>
  edge.state === undefined ? "text-foreground/60" : (STATE_TONE[edge.state] ?? "text-primary");

const edgeKey = (edge: FlowEdgeRef): string => `${edge.from}→${edge.to}`;

/**
 * Arrows between the board's frames, in the same coordinate space as the
 * frames themselves. A solid arrow is a transition to another step; a dashed
 * one, tinted by its state, says the frame it points at is the same step in
 * that state. Each carries a chip beside it that opens its editor and can be
 * slid along it. An arrow is cut where it would cross another frame, so it
 * never lies over a screen.
 *
 * Arrows are drawn by dragging the handle on a frame's edge (`FlowHandle`)
 * onto another frame, or by an agent through `connect_frames`.
 */
export function FlowLayer() {
  const visible = useCanvas((s) => s.markupVisible);
  const board = useCanvas((s) => (s.currentBoardId ? s.boards[s.currentBoardId] : undefined));
  const frameInsets = useCanvas((s) => s.frameInsets);
  const frameDrafts = useCanvas((s) => s.frameDrafts);
  const draft = useCanvas((s) => s.flowDraft);
  const screens = useCanvas((s) => s.screens);
  // Read for one thing: how much board a frame's header row covers, which an
  // arrow arriving from above has to clear. Weights and labels don't need it.
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  // The arrow the pointer is on or beside: its label comes forward and its
  // line firms up, which is also how a label is matched to its arrow.
  const [near, setNear] = useState<string | null>(null);
  if (!visible || !board) return null;

  const boxes = flowBoxes({ frameInsets, frameDrafts, canvasZoom }, board);
  const boxOf = new Map(boxes.map((box) => [box.id, box]));
  const edges = liveFlowEdges(board);
  const nameOf = (frameId: string): string => {
    const frame = board.frames.find((f) => f.id === frameId);
    return frame?.label ?? (frame ? screens[frame.screen]?.name : undefined) ?? frameId;
  };

  // Routed together: arrows that share a side of a frame each get their own
  // place along it, so no two run on one line.
  const routes = routeFlowEdges(boxOf, edges);
  const routed = edges.flatMap((edge, index) => {
    const route = routes[index];
    if (!route) return [];
    // An arrow is never drawn across a screen it isn't an arrow of: where it
    // would cross one it stops at the frame's edge and resumes on the far side.
    const covers = boxes.filter((box) => box.id !== edge.from && box.id !== edge.to);
    return [{ edge, route, spans: flowVisibleSpans(route, covers) }];
  });

  const draftFrom = draft ? boxOf.get(draft.from) : undefined;
  const draftTarget =
    draft && draftFrom
      ? flowFrameAt(
          boxes.filter((box) => box.id !== draft.from),
          draft,
          FLOW_DROP_REACH / (canvasZoom || 1),
        )
      : null;
  const targetBox = draftTarget ? boxOf.get(draftTarget) : undefined;

  if (routed.length === 0 && !draftFrom) return null;

  return (
    <>
      <svg
        data-flow-layer
        aria-hidden="true"
        width="1"
        height="1"
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
      >
        {routed.map(({ edge, route, spans }) => (
          <FlowArrow
            key={edgeKey(edge)}
            edge={edge}
            route={route}
            spans={spans}
            near={near === edgeKey(edge)}
            onNear={setNear}
          />
        ))}
        {draft && draftFrom ? (
          <g className="text-primary">
            {targetBox ? (
              <rect
                data-flow-drop-target={draftTarget}
                x={targetBox.x}
                y={targetBox.y}
                width={targetBox.w}
                height={targetBox.h}
                rx="6"
                fill="none"
                stroke="currentColor"
                style={{ strokeWidth: perZoom(2) }}
              />
            ) : null}
            <ArrowStroke route={routeFlowDraft(draftFrom, draft)} spans={WHOLE} dashed />
          </g>
        ) : null}
      </svg>
      {routed.map(({ edge, route, spans }) => (
        <FlowChip
          key={edgeKey(edge)}
          edge={edge}
          route={route}
          spans={spans}
          near={near === edgeKey(edge)}
          onNear={setNear}
          fromName={nameOf(edge.from)}
          toName={nameOf(edge.to)}
        />
      ))}
    </>
  );
}

const WHOLE: [number, number][] = [[0, 1]];

interface ArrowStrokeProps {
  route: FlowRoute;
  /** The stretches of the arrow in view (see `flowVisibleSpans`). */
  spans: readonly [number, number][];
  dashed: boolean;
  firm?: boolean;
}

function ArrowStroke({ route, spans, dashed, firm = false }: ArrowStrokeProps) {
  const line: CSSProperties = {
    strokeWidth: perZoom(firm ? 2.25 : 1.5),
    ...(dashed ? { strokeDasharray: `${perZoom(6)} ${perZoom(5)}` } : {}),
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
          // A short bar across the line at the frame's edge: the arrow doesn't
          // end here, it passes behind.
          <path
            key={t}
            data-flow-cut
            d="M 0 -5 L 0 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
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
  edge: FlowEdge;
  route: FlowRoute;
  spans: readonly [number, number][];
  near: boolean;
  onNear(key: string | null): void;
}

function FlowArrow({ edge, route, spans, near, onNear }: FlowArrowProps) {
  const setActive = useCanvas((s) => s.setActiveFlowEdge);
  const key = edgeKey(edge);
  return (
    <g data-flow-edge={key} data-flow-state={edge.state ?? ""} className={toneOf(edge)}>
      <ArrowStroke route={route} spans={spans} dashed={edge.state !== undefined} firm={near} />
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
          style={{ strokeWidth: perZoom(14), pointerEvents: "stroke", cursor: "pointer" }}
          onPointerEnter={() => onNear(key)}
          onPointerLeave={() => onNear(null)}
          onClick={() => setActive({ from: edge.from, to: edge.to })}
        />
      ))}
    </g>
  );
}

/** Screen px between an arrow and the chip that labels it. */
const CHIP_GAP = 7;

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

interface FlowChipProps {
  edge: FlowEdge;
  route: FlowRoute;
  spans: readonly [number, number][];
  near: boolean;
  onNear(key: string | null): void;
  fromName: string;
  toName: string;
}

/**
 * What the arrow says, sitting beside it — and the trigger for its editor. An
 * arrow that says nothing yet still gets a dot, so there is always something
 * to click.
 *
 * A label rests slightly see-through, so one that has to sit near a screen
 * doesn't blank out what is under it, and comes fully forward when the pointer
 * is on it or on its arrow. Its grip slides it along the arrow.
 */
function FlowChip({ edge, route, spans, near, onNear, fromName, toName }: FlowChipProps) {
  const ref: FlowEdgeRef = { from: edge.from, to: edge.to };
  const key = edgeKey(edge);
  const open = useCanvas((s) => sameFlowEdge(s.activeFlowEdge, ref));
  // Where the grip has dragged the label to, until the write that keeps it lands.
  const [dragAt, setDragAt] = useState<number | null>(null);
  const setActive = useCanvas((s) => s.setActiveFlowEdge);
  const connect = useCanvas((s) => s.connectFrames);
  const [label, setLabel] = useState(edge.label ?? "");
  const labelId = useId();

  // Someone else relabelled it (an agent, an undo) while this chip was mounted.
  useEffect(() => setLabel(edge.label ?? ""), [edge.label]);

  const commitLabel = () => {
    const next = label.trim();
    if (next !== (edge.label ?? "")) void connect([{ ...ref, label: next === "" ? null : next }]);
  };
  // The conventional four, plus whatever this arrow already says — an agent
  // may have written "offline", and the editor must be able to show and clear it.
  const states: string[] =
    edge.state === undefined || (FLOW_STATES as readonly string[]).includes(edge.state)
      ? [...FLOW_STATES]
      : [...FLOW_STATES, edge.state];
  const bare = edge.label === undefined && edge.state === undefined;
  const at = flowPointAt(route, dragAt ?? edge.labelAt ?? flowLabelT(spans));

  const slide = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const grip = e.currentTarget;
    const world = grip.closest<HTMLElement>("[data-velloo-board-world]");
    if (!world) return;
    e.preventDefault();
    e.stopPropagation();
    grip.setPointerCapture(e.pointerId);
    const along = (ev: { clientX: number; clientY: number }) =>
      Math.min(LABEL_T.max, Math.max(LABEL_T.min, flowNearestT(route, boardPointOf(world, ev))));
    const onMove = (ev: PointerEvent) => setDragAt(along(ev));
    const stop = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", cancel);
    };
    const cancel = () => {
      stop();
      setDragAt(null);
    };
    const onUp = (ev: PointerEvent) => {
      stop();
      const labelAt = Math.round(along(ev) * 100) / 100;
      setDragAt(labelAt);
      // Held where it was dropped until the board comes back with it there.
      void connect([{ ...ref, labelAt }]).finally(() => setDragAt(null));
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", cancel);
  };

  return (
    <div
      data-flow-label={key}
      data-flow-near={near || open || dragAt !== null ? "" : undefined}
      className="absolute opacity-70 transition-opacity data-[flow-near]:opacity-100"
      style={{
        left: at.x,
        top: at.y,
        transform: `translate(-50%, -50%) ${COUNTER_SCALE}${bare ? "" : ` ${chipLift(at.angle, route.lane)}`}`,
      }}
      onPointerEnter={() => onNear(key)}
      onPointerLeave={() => onNear(null)}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Closing unmounts the input without a blur, so the label is saved here.
          if (!next) commitLabel();
          setActive(next ? ref : null);
        }}
      >
        {bare ? (
          <PopoverTrigger asChild>
            <button
              type="button"
              data-flow-chip={key}
              aria-label={`Arrow from ${fromName} to ${toName}`}
              className="block size-2.5 rounded-full border border-border bg-background shadow-xs hover:scale-150 hover:border-primary data-[state=open]:border-primary transition-transform"
            />
          </PopoverTrigger>
        ) : (
          <div className="flex max-w-60 items-center rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5 text-xs text-foreground shadow-xs hover:border-primary has-data-[state=open]:border-primary">
            <div
              role="presentation"
              data-flow-grip={key}
              title="Drag to slide along the arrow"
              onPointerDown={slide}
              className="grid h-4 w-3.5 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical size={12} strokeWidth={2} />
            </div>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-flow-chip={key}
                aria-label={`Arrow from ${fromName} to ${toName}${edge.label ? `: ${edge.label}` : ""}`}
                className="flex min-w-0 items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {edge.state !== undefined ? (
                  <Badge variant="outline" className={`${toneOf(edge)} bg-background`}>
                    {edge.state}
                  </Badge>
                ) : null}
                {edge.label !== undefined ? (
                  <span className={`truncate ${edge.state === undefined ? "pl-0.5" : ""}`}>
                    {edge.label}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
          </div>
        )}
        {/* Anchored inside the pan/zoom transform, which nothing announces as a
            scroll or a resize — so the popover re-measures every frame while open. */}
        <PopoverContent side="top" className="w-80" updatePositionStrategy="always">
          <PopoverHeader>
            <PopoverTitle className="truncate">
              {fromName} → {toName}
            </PopoverTitle>
          </PopoverHeader>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor={labelId}>When</FieldLabel>
              <Input
                id={labelId}
                value={label}
                maxLength={120}
                placeholder={edge.state === undefined ? "Submit" : "Email already taken"}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitLabel();
                    setActive(null);
                  }
                }}
              />
            </Field>
            <Field>
              <FieldLabel>State of the same step</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                className="flex-wrap"
                value={edge.state ?? ""}
                onValueChange={(next) =>
                  void connect([{ ...ref, state: next === "" ? null : next }])
                }
              >
                {states.map((state) => (
                  <ToggleGroupItem key={state} value={state} data-flow-state-option={state}>
                    {state}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription>
                {edge.state === undefined
                  ? `None — this arrow leads on to another step.`
                  : `“${toName}” is “${fromName}” in its ${edge.state} state.`}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            onClick={() => void connect([{ ...ref, remove: true }])}
          >
            <Trash2 data-icon="inline-start" />
            Remove arrow
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
