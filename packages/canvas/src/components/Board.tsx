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
   * On board mount (or board switch): restore the user's saved pan +
   * zoom for this board from localStorage. If there's no saved view
   * (first time seeing this board), fall back to fit-to-content so the
   * board's frames center in the visible area.
   *
   * Only runs once per board id — once the user pans/zooms, we don't
   * yank the view back, and we persist their changes via the
   * pan/zoom watcher effect below.
   */
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (restoredRef.current === board.id) return;

    const saved = readBoardView(board.id);
    if (saved) {
      setZoom(saved.zoom);
      setPan(saved.pan);
      restoredRef.current = board.id;
      return;
    }

    // First-time view: compute fit-to-content.
    if (board.frames.length === 0) {
      restoredRef.current = board.id;
      return;
    }
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
      setZoom(fitZoom);
      setPan({
        x: Math.round(vw / 2 - boxCx * fitZoom),
        y: Math.round(vh / 2 - boxCy * fitZoom),
      });
      restoredRef.current = board.id;
      return true;
    };

    // Try right now; retry on the next frame for the common "wrapper
    // not laid out yet" case. If neither attempt works (slow first
    // paint, fonts loading, sidebar still expanding), watch the
    // wrapper with ResizeObserver and re-apply as soon as it gets
    // real dimensions — then disconnect.
    if (apply()) return;
    let ro: ResizeObserver | null = null;
    const rafId = requestAnimationFrame(() => {
      if (apply()) return;
      ro = new ResizeObserver(() => {
        if (apply()) ro?.disconnect();
      });
      ro.observe(el);
    });
    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [board.id, board.frames, setZoom, setPan]);

  // Persist pan + zoom whenever they change, scoped per board. A
  // small debounce keeps localStorage writes off the wheel/drag hot
  // path — we only write 150ms after the user stops manipulating.
  useEffect(() => {
    if (restoredRef.current !== board.id) return;
    const t = setTimeout(() => writeBoardView(board.id, { pan, zoom }), 150);
    return () => clearTimeout(t);
  }, [board.id, pan, zoom]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl + wheel → zoom anchored on the cursor. Keeps
        // the world coordinate under the cursor pinned across the
        // zoom step so the user doesn't have to re-pan after each
        // zoom in/out.
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.95 : 1.05;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        zoomAtPoint(cx, cy, factor, zoom, pan, setZoom, setPan);
        return;
      }
      // Plain wheel → pan via transform. We don't use native overflow
      // scrolling because transform changes don't affect scroll size,
      // which made the canvas feel like it had a "wrong-sized" world
      // depending on zoom. Now pan is the only movement axis.
      e.preventDefault();
      setPan({ x: pan.x - e.deltaX, y: pan.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, pan, setZoom, setPan]);

  /** Translate a client-space pointer event to world (board) coords. */
  const clientToBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    // The world is `translate(pan) scale(zoom)` of the wrapper's content.
    // Reverse it: subtract the wrapper's top-left and pan, divide by
    // zoom. (No scroll offsets — the wrapper is `overflow-hidden` and
    // pan is the only movement mechanism.)
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
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
      data-velloo-board="true"
      className="flex-1 overflow-hidden bg-[var(--color-bg-soft)] relative"
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

/**
 * Apply a zoom step centered on a point in wrapper-local coords.
 * Keeps the world coordinate under (anchorX, anchorY) fixed across
 * the zoom transition: `cursor = pan + world * zoom` solved for the
 * new pan after zoom changes. Clamps the result to the same bounds
 * setCanvasZoom uses so we never overshoot.
 */
function zoomAtPoint(
  anchorX: number,
  anchorY: number,
  factor: number,
  zoom: number,
  pan: { x: number; y: number },
  setZoom: (z: number) => void,
  setPan: (p: { x: number; y: number }) => void,
): void {
  const nextZoom = Math.max(0.1, Math.min(4, zoom * factor));
  if (nextZoom === zoom) return;
  // world coord under the cursor before the zoom change
  const worldX = (anchorX - pan.x) / zoom;
  const worldY = (anchorY - pan.y) / zoom;
  // after the zoom change, pin the same world coord under the cursor
  setZoom(nextZoom);
  setPan({
    x: Math.round(anchorX - worldX * nextZoom),
    y: Math.round(anchorY - worldY * nextZoom),
  });
}

const VIEW_STORAGE_PREFIX = "velloo:boardView:";

interface BoardView {
  pan: { x: number; y: number };
  zoom: number;
}

/**
 * Pull this board's last pan+zoom from localStorage. Returns null if
 * we've never persisted a view for this board (or the stored value
 * is corrupt) so the caller can fall back to fit-to-content.
 */
function readBoardView(boardId: string): BoardView | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_PREFIX + boardId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoardView>;
    const zoom =
      typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) ? parsed.zoom : null;
    const px =
      parsed.pan && typeof parsed.pan.x === "number" && Number.isFinite(parsed.pan.x)
        ? parsed.pan.x
        : null;
    const py =
      parsed.pan && typeof parsed.pan.y === "number" && Number.isFinite(parsed.pan.y)
        ? parsed.pan.y
        : null;
    if (zoom === null || px === null || py === null) return null;
    return { pan: { x: px, y: py }, zoom };
  } catch {
    return null;
  }
}

function writeBoardView(boardId: string, view: BoardView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VIEW_STORAGE_PREFIX + boardId, JSON.stringify(view));
  } catch {
    // Quota / private-mode failures are silently swallowed —
    // pan/zoom persistence is a convenience, not a critical path.
  }
}
