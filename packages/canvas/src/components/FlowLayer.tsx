import { FLOW_STATES, type FlowEdge, liveFlowEdges } from "@velloo/schema";
import { Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useId, useState } from "react";
import {
  type FlowBox,
  type FlowRoute,
  flowFrameAt,
  routeFlowDraft,
  routeFlowEdge,
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
 * that state. Each carries a chip at its midpoint that opens its editor.
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
  if (!visible || !board) return null;

  const boxes = flowBoxes({ frameInsets, frameDrafts, canvasZoom }, board);
  const boxOf = new Map(boxes.map((box) => [box.id, box]));
  const edges = liveFlowEdges(board);
  const pairs = new Set(edges.map(edgeKey));
  const nameOf = (frameId: string): string => {
    const frame = board.frames.find((f) => f.id === frameId);
    return frame?.label ?? (frame ? screens[frame.screen]?.name : undefined) ?? frameId;
  };

  const routed = edges.map((edge) => ({
    edge,
    route: routeFlowEdge(
      boxOf.get(edge.from) as FlowBox,
      boxOf.get(edge.to) as FlowBox,
      pairs.has(edgeKey({ from: edge.to, to: edge.from })),
    ),
  }));

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
        {routed.map(({ edge, route }) => (
          <FlowArrow key={edgeKey(edge)} edge={edge} route={route} />
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
            <ArrowStroke route={routeFlowDraft(draftFrom, draft)} dashed />
          </g>
        ) : null}
      </svg>
      {routed.map(({ edge, route }) => (
        <FlowChip
          key={edgeKey(edge)}
          edge={edge}
          route={route}
          fromName={nameOf(edge.from)}
          toName={nameOf(edge.to)}
        />
      ))}
    </>
  );
}

function ArrowStroke({ route, dashed }: { route: FlowRoute; dashed: boolean }) {
  const line: CSSProperties = {
    strokeWidth: perZoom(1.5),
    ...(dashed ? { strokeDasharray: `${perZoom(6)} ${perZoom(5)}` } : {}),
  };
  return (
    <>
      <path d={route.d} fill="none" stroke="currentColor" strokeLinecap="round" style={line} />
      <path
        d="M 0 0 L -10 -4.5 L -10 4.5 Z"
        fill="currentColor"
        style={{
          transform: `translate(${route.end.x}px, ${route.end.y}px) rotate(${route.angle}deg) ${COUNTER_SCALE}`,
        }}
      />
    </>
  );
}

function FlowArrow({ edge, route }: { edge: FlowEdge; route: FlowRoute }) {
  const setActive = useCanvas((s) => s.setActiveFlowEdge);
  return (
    <g data-flow-edge={edgeKey(edge)} data-flow-state={edge.state ?? ""} className={toneOf(edge)}>
      <ArrowStroke route={route} dashed={edge.state !== undefined} />
      {/* A hairline is no target: a wide invisible stroke takes the click. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the chip at the arrow's midpoint is the keyboard path to the same editor. */}
      <path
        d={route.d}
        fill="none"
        stroke="transparent"
        style={{ strokeWidth: perZoom(14), pointerEvents: "stroke", cursor: "pointer" }}
        onClick={() => setActive({ from: edge.from, to: edge.to })}
      />
    </g>
  );
}

/** Screen px between an arrow and the chip that labels it. */
const CHIP_GAP = 7;

/**
 * Where a labelled chip sits relative to the arrow's midpoint: beside the
 * line, never on it. Frames are often placed closer together than a label is
 * wide, and a chip centred on a short arrow hides the whole of it — head
 * included, which is the one thing an arrow has to show. Above a level arrow
 * and to the right of an upright one; an arrow sharing its pair of frames with
 * one going back takes the side its lane is already on, so the two labels part
 * the way the lines do.
 *
 * Written after the counter-scale, so the lengths are screen px.
 */
function chipLift(route: FlowRoute): string {
  if (route.axis === "x") {
    return route.lane === 1
      ? `translate(0, calc(50% + ${CHIP_GAP}px))`
      : `translate(0, calc(-50% - ${CHIP_GAP}px))`;
  }
  return route.lane === -1
    ? `translate(calc(-50% - ${CHIP_GAP}px), 0)`
    : `translate(calc(50% + ${CHIP_GAP}px), 0)`;
}

interface FlowChipProps {
  edge: FlowEdge;
  route: FlowRoute;
  fromName: string;
  toName: string;
}

/**
 * What the arrow says, sitting on it — and the trigger for its editor. An
 * arrow that says nothing yet still gets a dot, so there is always something
 * to click.
 */
function FlowChip({ edge, route, fromName, toName }: FlowChipProps) {
  const ref: FlowEdgeRef = { from: edge.from, to: edge.to };
  const open = useCanvas((s) => sameFlowEdge(s.activeFlowEdge, ref));
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

  return (
    <div
      className="absolute"
      style={{
        left: route.mid.x,
        top: route.mid.y,
        transform: `translate(-50%, -50%) ${COUNTER_SCALE}${bare ? "" : ` ${chipLift(route)}`}`,
      }}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Closing unmounts the input without a blur, so the label is saved here.
          if (!next) commitLabel();
          setActive(next ? ref : null);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-flow-chip={edgeKey(edge)}
            aria-label={`Arrow from ${fromName} to ${toName}${edge.label ? `: ${edge.label}` : ""}`}
            className={
              bare
                ? "block size-2.5 rounded-full border border-border bg-background shadow-xs hover:scale-150 hover:border-primary data-[state=open]:border-primary transition-transform"
                : "flex max-w-56 items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5 text-xs text-foreground shadow-xs hover:border-primary data-[state=open]:border-primary"
            }
          >
            {edge.state !== undefined ? (
              <Badge variant="outline" className={`${toneOf(edge)} bg-background`}>
                {edge.state}
              </Badge>
            ) : null}
            {edge.label !== undefined ? (
              <span className={`truncate ${edge.state === undefined ? "pl-1.5" : ""}`}>
                {edge.label}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
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
