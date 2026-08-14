import type { Board as BoardT, ViewportPreset } from "@velloo/schema";
import { useEffect, useMemo, useRef } from "react";
import { notes as notesApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { AnnotationsLayer } from "./AnnotationsLayer.tsx";
import { Frame } from "./Frame.tsx";
import { NotesLayer } from "./NotesLayer.tsx";

interface BoardProps {
  board: BoardT;
}

/**
 * The infinite canvas for one board. Frames are absolutely positioned in
 * board coords; a pan+zoom transform wraps the world.
 *
 * Pan in hand-tool / Space-hold mode; zoom on Cmd/Ctrl+wheel. Frames disable
 * their iframe pointer-events when the cursor is in hand/note mode so
 * dragging works seamlessly across the whole surface.
 */
export function Board({ board }: BoardProps) {
  const zoom = useCanvas((s) => s.canvasZoom);
  const pan = useCanvas((s) => s.pan);
  const setZoom = useCanvas((s) => s.setCanvasZoom);
  const setPan = useCanvas((s) => s.setPan);
  const cursorMode = useCanvas((s) => s.cursorMode);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  } | null>(null);

  const bounds = useMemo(() => {
    let maxX = 800;
    let maxY = 600;
    for (const f of board.frames) {
      if (f.x + f.w > maxX) maxX = f.x + f.w;
      if (f.y + f.h > maxY) maxY = f.y + f.h;
    }
    return { w: maxX + 600, h: maxY + 400 };
  }, [board.frames]);

  const sharedScreenCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of board.frames) counts[f.screen] = (counts[f.screen] ?? 0) + 1;
    return counts;
  }, [board.frames]);

  /**
   * On board mount (or board switch), fit-to-content: pick a zoom that shows
   * the whole frame bounding box with margin, then pan so the box centers in
   * the visible area. Only runs once per board id — once the user pans/zooms,
   * we don't yank the view back.
   */
  const fitToContentRef = useRef<string | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (board.frames.length === 0) return;
    if (fitToContentRef.current === board.id) return;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const f of board.frames) {
      if (f.x < minX) minX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.x + f.w > maxX) maxX = f.x + f.w;
      // Allow some height for the frame header + preset chips below.
      if (f.y + f.h + 60 > maxY) maxY = f.y + f.h + 60;
    }
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const boxCx = (minX + maxX) / 2;
    const boxCy = (minY + maxY) / 2;

    const apply = () => {
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw < 50 || vh < 50) return false;
      const margin = 80;
      const zoomX = (vw - margin * 2) / boxW;
      const zoomY = (vh - margin * 2) / boxH;
      // Cap at 1.0 — never up-scale; 0.75 is the lower bound for legibility.
      const fitZoom = Math.max(0.1, Math.min(1.0, Math.min(zoomX, zoomY)));
      // Reset native scroll so the transform alone positions content.
      el.scrollLeft = 0;
      el.scrollTop = 0;
      setZoom(fitZoom);
      setPan({
        x: Math.round(vw / 2 - boxCx * fitZoom),
        y: Math.round(vh / 2 - boxCy * fitZoom),
      });
      fitToContentRef.current = board.id;
      return true;
    };

    if (!apply()) {
      // Wrapper not sized yet (first paint) — try again next frame.
      requestAnimationFrame(apply);
    }
  }, [board.id, board.frames, setZoom, setPan]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      setZoom(zoom * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, setZoom]);

  /** Translate a client-space pointer event to world (board) coords. */
  const clientToBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    // The world is `translate(pan) scale(zoom)` of the wrapper's content.
    // Reverse it: subtract the wrapper's top-left, scroll offsets, and pan;
    // divide by zoom.
    return {
      x: (clientX - rect.left + el.scrollLeft - pan.x) / zoom,
      y: (clientY - rect.top + el.scrollTop - pan.y) / zoom,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (cursorMode === "hand") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
      return;
    }
    if (cursorMode === "note") {
      // Place a note at the click location, in board coords.
      const where = clientToBoard(e.clientX, e.clientY);
      const boardId = useCanvas.getState().currentBoardId;
      if (!boardId) return;
      e.preventDefault();
      void notesApi
        .add({ boardId, x: where.x, y: where.y, body: "" })
        .then((r) => {
          useCanvas.getState().setEditingMarkupId(r.note.id);
        })
        .catch((err) => toastError(err, "Could not add note"));
      // Return to select mode after dropping the note so the next click
      // doesn't spawn another.
      useCanvas.getState().setCursorMode("select");
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p) return;
    setPan({
      x: p.startPan.x + (e.clientX - p.startX),
      y: p.startPan.y + (e.clientY - p.startY),
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // The captured element may already be detached; ignore.
    }
    panRef.current = null;
  };

  // Safety net: if a pan starts and the pointer is released outside the
  // wrapper (e.g. browser dispatches the up to a foreign iframe or the
  // capture is lost on an unrelated re-render), the wrapper never gets
  // pointerup and `panRef` stays set — every subsequent mousemove drags
  // the world. A window-level pointerup catches every release and clears
  // the ref so the pointer tool can never get permanently wedged.
  useEffect(() => {
    const onWindowUp = () => {
      panRef.current = null;
    };
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    window.addEventListener("blur", onWindowUp);
    return () => {
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
      window.removeEventListener("blur", onWindowUp);
    };
  }, []);

  // When cursor mode changes (e.g. user Esc'd out of hand or note),
  // clear any in-flight pan state defensively. Stops "tool sometimes
  // doesn't work" wedges where panRef survived a mode flip.
  useEffect(() => {
    if (cursorMode !== "hand") panRef.current = null;
  }, [cursorMode]);

  return (
    <div
      ref={wrapperRef}
      className="flex-1 overflow-auto bg-[var(--color-bg-soft)] relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        cursor:
          cursorMode === "hand"
            ? panRef.current
              ? "grabbing"
              : "grab"
            : cursorMode === "note"
              ? "crosshair"
              : "default",
      }}
    >
      <div
        className="relative origin-top-left"
        style={{
          width: bounds.w,
          height: bounds.h,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {board.frames.map((frame) => (
          <Frame
            key={frame.id}
            boardId={board.id}
            frame={frame}
            otherFrames={board.frames.filter((f) => f.id !== frame.id)}
            presets={DEFAULT_PRESETS}
            sharedCount={sharedScreenCounts[frame.screen] ?? 1}
          />
        ))}
        <NotesLayer />
        <AnnotationsLayer />
      </div>
    </div>
  );
}

const DEFAULT_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];
