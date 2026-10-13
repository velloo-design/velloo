import { FLOW_STATES, liveFlowEdges } from "@velloo/schema";
import { GripVertical, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { flowFrameAt, flowNearestT, routeFlowDraft } from "../flow-geometry.ts";
import { type FlowEdgeRef, flowBoxes, sameFlowEdge } from "../store/flow.ts";
import { useCanvas } from "../store.ts";
import {
  FLOW_LABEL_PILL,
  FlowArrowStroke,
  FlowLabelAnchor,
  FlowLabelText,
  FlowView,
  flowPerZoom,
  type RoutedFlowEdge,
} from "./flow-view.tsx";
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

/**
 * The board's arrows on the editing canvas: `FlowView` draws them — the same
 * component a share draws them with — and this adds what only an editor has.
 * Each label opens the arrow's editor and has a grip that slides it along the
 * arrow; an arrow being dragged out of a frame is drawn to the pointer.
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
  // Read for two things that hold their size on screen: how much board a
  // frame's header row covers, and the gap where an arrow is cut. Weights and
  // labels don't need it.
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const setActive = useCanvas((s) => s.setActiveFlowEdge);
  if (!visible || !board) return null;

  // A frame mid-drag is where the drag has it, so its arrows follow.
  const frames = board.frames.map((frame) => ({ ...frame, ...frameDrafts[frame.id] }));
  const nameOf = (frameId: string): string => {
    const frame = board.frames.find((f) => f.id === frameId);
    return frame?.label ?? (frame ? screens[frame.screen]?.name : undefined) ?? frameId;
  };

  const boxes = flowBoxes({ frameInsets, frameDrafts, canvasZoom }, board);
  const draftFrom = draft ? boxes.find((box) => box.id === draft.from) : undefined;
  const draftTarget =
    draft && draftFrom
      ? flowFrameAt(
          boxes.filter((box) => box.id !== draft.from),
          draft,
          FLOW_DROP_REACH / (canvasZoom || 1),
        )
      : null;
  const targetBox = draftTarget ? boxes.find((box) => box.id === draftTarget) : undefined;

  return (
    <FlowView
      frames={frames}
      insets={frameInsets}
      zoom={canvasZoom}
      edges={liveFlowEdges(board)}
      onPick={(edge) => setActive({ from: edge.from, to: edge.to })}
      label={({ routed, near, onNear }) => (
        <FlowChip
          routed={routed}
          near={near}
          onNear={onNear}
          fromName={nameOf(routed.edge.from)}
          toName={nameOf(routed.edge.to)}
        />
      )}
      overlay={
        draft && draftFrom ? (
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
                style={{ strokeWidth: flowPerZoom(2) }}
              />
            ) : null}
            <FlowArrowStroke route={routeFlowDraft(draftFrom, draft)} dashed />
          </g>
        ) : undefined
      }
    />
  );
}

interface FlowChipProps {
  routed: RoutedFlowEdge;
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
function FlowChip({ routed, near, onNear, fromName, toName }: FlowChipProps) {
  const { key, edge, route } = routed;
  const ref: FlowEdgeRef = { from: edge.from, to: edge.to };
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
    <FlowLabelAnchor
      routed={routed}
      at={dragAt}
      bare={bare}
      near={near}
      forward={open || dragAt !== null}
      onNear={onNear}
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
          <div
            className={`${FLOW_LABEL_PILL} hover:border-primary has-data-[state=open]:border-primary`}
          >
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
                <FlowLabelText edge={edge} />
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
    </FlowLabelAnchor>
  );
}
