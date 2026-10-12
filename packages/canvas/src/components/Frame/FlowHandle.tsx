import { liveFlowEdges } from "@velloo/schema";
import { flowFrameAt } from "../../flow-geometry.ts";
import { flowBoxes, sameFlowEdge } from "../../store/flow.ts";
import { useCanvas } from "../../store.ts";
import { FLOW_DROP_REACH } from "../FlowLayer.tsx";

/**
 * The dot on a frame's right edge that an arrow is dragged out of. Dropping it
 * on another frame draws the arrow and opens its editor, so the next thing
 * typed is what the arrow says; dropping it anywhere else draws nothing.
 *
 * Hidden with the rest of the markup, and outside select mode — the hand and
 * note tools own the pointer there.
 */
export function FlowHandle({ frameId }: { frameId: string }) {
  const shown = useCanvas((s) => s.markupVisible && s.cursorMode === "select");
  if (!shown) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const world = handle.closest<HTMLElement>("[data-velloo-board-world]");
    if (!world) return;
    e.preventDefault();
    e.stopPropagation();
    // Capture, so the drag keeps reporting while it crosses other frames'
    // iframes — which would otherwise swallow every move.
    handle.setPointerCapture(e.pointerId);

    const store = useCanvas.getState;
    // The world element is the board's `translate(pan) scale(zoom)`, so its
    // on-screen corner is the board origin and the zoom is the only divisor.
    const toBoard = (ev: { clientX: number; clientY: number }) => {
      const origin = world.getBoundingClientRect();
      const zoom = store().canvasZoom || 1;
      return { x: (ev.clientX - origin.left) / zoom, y: (ev.clientY - origin.top) / zoom };
    };
    store().setFlowDraft({ from: frameId, ...toBoard(e) });

    const onMove = (ev: PointerEvent) => store().setFlowDraft({ from: frameId, ...toBoard(ev) });
    const stop = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", stop);
      store().setFlowDraft(null);
    };
    const onUp = (ev: PointerEvent) => {
      stop();
      const state = store();
      const board = state.currentBoardId ? state.boards[state.currentBoardId] : undefined;
      if (!board) return;
      const to = flowFrameAt(
        flowBoxes(state, board).filter((box) => box.id !== frameId),
        toBoard(ev),
        FLOW_DROP_REACH / (state.canvasZoom || 1),
      );
      if (!to) return;
      const edge = { from: frameId, to };
      // Dropping on a frame this one already points at edits that arrow.
      if (liveFlowEdges(board).some((existing) => sameFlowEdge(existing, edge))) {
        state.setActiveFlowEdge(edge);
        return;
      }
      void state.connectFrames([edge]).then((edges) => {
        if (edges) store().setActiveFlowEdge(edge);
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", stop);
  };

  return (
    <div
      role="presentation"
      data-flow-handle={frameId}
      title="Drag onto another frame to connect them"
      onPointerDown={onPointerDown}
      className="absolute right-0 top-1/2 size-3.5 cursor-crosshair rounded-full border-2 border-background bg-primary opacity-0 shadow-xs transition-opacity group-hover:opacity-100 hover:opacity-100"
      style={{ transform: "translate(50%, -50%) scale(calc(1 / var(--canvas-zoom, 1)))" }}
    />
  );
}
