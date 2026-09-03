import type { Board as BoardT, ViewportPreset } from "@velloo/schema";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { notes as notesApi } from "../api.ts";
import { fitToContent, wheelZoomFactor, zoomAtPoint } from "../board-geometry.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { CommentPinsLayer } from "./CommentPinsLayer.tsx";
import { Frame } from "./Frame.tsx";
import { NotesLayer } from "./NotesLayer.tsx";
import { PendingCommentComposer } from "./PendingCommentComposer.tsx";

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
  // Deliberately NOT subscribed to pan/zoom: wheel/drag ticks must not
  // re-render the whole board. The transform lives in BoardWorld; handlers
  // read pan/zoom via useCanvas.getState().
  const setZoom = useCanvas((s) => s.setCanvasZoom);
  const setPan = useCanvas((s) => s.setPan);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const [panning, setPanning] = useState(false);

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

    // First-time view: compute fit-to-content (shared with the cloud viewer).
    if (board.frames.length === 0) {
      restoredRef.current = board.id;
      return;
    }
    const apply = () => {
      const fit = fitToContent(board.frames, el.clientWidth, el.clientHeight);
      if (!fit) return false;
      // Reset native scroll so the transform alone positions content.
      setZoom(fit.zoom);
      setPan(fit.pan);
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

  // Bound once: the handler reads pan/zoom through getState() so it never
  // goes stale, instead of re-adding the listener on every pan/zoom tick.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const state = useCanvas.getState();
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl + wheel → zoom anchored on the cursor. Keeps
        // the world coordinate under the cursor pinned across the
        // zoom step so the user doesn't have to re-pan after each
        // zoom in/out.
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const next = zoomAtPoint(cx, cy, wheelZoomFactor(e.deltaY), {
          zoom: state.canvasZoom,
          pan: state.pan,
        });
        state.setCanvasZoom(next.zoom);
        state.setPan(next.pan);
        return;
      }
      // Plain wheel → pan via transform. We don't use native overflow
      // scrolling because transform changes don't affect scroll size,
      // which made the canvas feel like it had a "wrong-sized" world
      // depending on zoom. Now pan is the only movement axis.
      e.preventDefault();
      state.setPan({ x: state.pan.x - e.deltaX, y: state.pan.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Translate a client-space pointer event to world (board) coords. */
  const clientToBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = wrapperRef.current;
    if (!el) return { x: 0, y: 0 };
    const { canvasZoom: zoom, pan } = useCanvas.getState();
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
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPan: { ...useCanvas.getState().pan },
      };
      setPanning(true);
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
          // Insert optimistically so the editor opens now — the ws
          // notes-changed refresh confirms it. Setting the editing id before
          // the note exists in the store would race the vanished-edit sweep.
          useCanvas.setState((s) => ({
            notes: s.notes.some((n) => n.id === r.note.id) ? s.notes : [...s.notes, r.note],
          }));
          useCanvas.getState().setEditingMarkupId(r.note.id);
        })
        .catch((err) => toastError(err, "Could not add note"));
      // Return to select mode after dropping the note so the next click
      // doesn't spawn another.
      useCanvas.getState().setCursorMode("select");
      return;
    }
    if (
      cursorMode === "comment" &&
      (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.vellooBoardWorld)
    ) {
      const where = clientToBoard(e.clientX, e.clientY);
      e.preventDefault();
      useCanvas.getState().beginComment({ kind: "board", boardId: board.id, ...where });
      return;
    }
    // Select / comment: clicking the board chrome (not a frame/note/card)
    // clears the current node selection.
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.vellooBoardWorld) {
      useCanvas.getState().setSelection(null);
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
    setPanning(false);
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
      setPanning(false);
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
    if (cursorMode !== "hand") {
      panRef.current = null;
      setPanning(false);
    }
  }, [cursorMode]);

  return (
    <div
      ref={wrapperRef}
      data-velloo-board="true"
      className="flex-1 overflow-hidden bg-muted/30 relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        cursor:
          cursorMode === "hand"
            ? panning
              ? "grabbing"
              : "grab"
            : cursorMode === "note"
              ? "crosshair"
              : cursorMode === "comment"
                ? "cell"
                : "default",
      }}
    >
      <BoardWorld boardId={board.id} restoredRef={restoredRef} w={bounds.w} h={bounds.h}>
        {board.frames.map((frame) => (
          <Frame
            key={frame.id}
            boardId={board.id}
            frame={frame}
            frames={board.frames}
            presets={DEFAULT_PRESETS}
            sharedCount={sharedScreenCounts[frame.screen] ?? 1}
          />
        ))}
        <NotesLayer />
        <PendingCommentComposer />
        <CommentPinsLayer />
      </BoardWorld>
    </div>
  );
}

/**
 * The pan/zoom transform wrapper — the only place that subscribes to
 * pan/zoom, so wheel/drag ticks re-render just this div. `children` are
 * built by Board (which doesn't subscribe), so their element identity is
 * stable across ticks and React skips reconciling the frame subtree.
 */
function BoardWorld({
  boardId,
  restoredRef,
  w,
  h,
  children,
}: {
  boardId: string;
  /** Set by Board's restore effect; persistence must wait for it. */
  restoredRef: RefObject<string | null>;
  w: number;
  h: number;
  children: ReactNode;
}) {
  const zoom = useCanvas((s) => s.canvasZoom);
  const pan = useCanvas((s) => s.pan);

  // Persist pan + zoom whenever they change, scoped per board. A
  // small debounce keeps localStorage writes off the wheel/drag hot
  // path — we only write 150ms after the user stops manipulating.
  useEffect(() => {
    if (restoredRef.current !== boardId) return;
    const t = setTimeout(() => writeBoardView(boardId, { pan, zoom }), 150);
    return () => clearTimeout(t);
  }, [boardId, pan, zoom, restoredRef]);

  return (
    <div
      data-velloo-board-world="true"
      className="relative origin-top-left"
      style={
        {
          width: w,
          height: h,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          // Frame chrome (headers, preset chips) counter-scales against this
          // so labels stay readable at any zoom — pure CSS, so zoom ticks
          // still re-render only this wrapper, never the frames.
          "--canvas-zoom": zoom,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

const DEFAULT_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];

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
