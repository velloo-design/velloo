import { useRef } from "react";
import { clampPaneWidth, PANE_WIDTH } from "../store/modes.ts";

interface Props {
  side: "left" | "right";
  width: number;
  onCommit: (width: number) => void;
  /** The pane this handle sizes, driven directly for the length of a drag. */
  paneRef: React.RefObject<HTMLElement | null>;
}

/**
 * The drag handle on a pane's inner edge. A drag writes `style.width` straight
 * onto the pane and only commits to the store on release: these panes host the
 * screen tree and the inspector, and re-rendering either at pointermove rate
 * leaves the edge trailing the cursor.
 *
 * `pointer-events-auto` because the right pane turns its own off while the
 * daemon is unreachable — resizing is chrome, like collapsing, so it survives.
 */
export function PaneResizer({ side, width, onCommit, paneRef }: Props) {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const apply = (next: number) => {
    const pane = paneRef.current;
    if (pane) pane.style.width = `${next}px`;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, width };
    document.body.classList.add("velloo-resizing");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Dragging away from the pane's own edge widens it, whichever side it's on.
    const delta = side === "left" ? e.clientX - d.startX : d.startX - e.clientX;
    d.width = clampPaneWidth(d.startWidth + delta);
    apply(d.width);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.classList.remove("velloo-resizing");
    onCommit(d.width);
  };

  const nudge = (towardsPane: boolean, shift: boolean) => {
    const step = shift ? 48 : 16;
    onCommit(clampPaneWidth(width + (towardsPane ? -step : step)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(side === "left", e.shiftKey);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(side === "right", e.shiftKey);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCommit(PANE_WIDTH.default);
    }
  };

  const label = `Resize ${side === "left" ? "sidebar" : "inspector"}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> can't be a focusable window splitter — the ARIA pattern is a valued, tabbable separator
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANE_WIDTH.min}
      aria-valuemax={PANE_WIDTH.max}
      tabIndex={0}
      title={`${label} — double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        apply(PANE_WIDTH.default);
        onCommit(PANE_WIDTH.default);
      }}
      onKeyDown={onKeyDown}
      className={
        "group absolute inset-y-0 z-10 w-1.5 cursor-col-resize pointer-events-auto outline-none " +
        (side === "left" ? "right-0" : "left-0")
      }
    >
      <div
        className={
          "h-full w-px bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary " +
          (side === "left" ? "ml-auto" : "mr-auto")
        }
      />
    </div>
  );
}
