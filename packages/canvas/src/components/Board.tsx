import type { Board as BoardT, ViewportPreset } from "@velloo/schema";
import { useEffect, useMemo, useRef } from "react";
import { useCanvas } from "../store.ts";
import { Frame } from "./Frame.tsx";

interface BoardProps {
  board: BoardT;
}

/**
 * The infinite canvas. Frames are absolutely positioned in board coords;
 * a pan+zoom transform wraps the world. Pan in hand-tool / Space-hold mode;
 * zoom on Cmd/Ctrl+wheel (browser zoom on bare wheel is preserved).
 *
 * Sprint D adds the interactive affordances: pan/zoom polish, per-frame
 * resize handles + viewport-preset chips (in Frame.tsx), and the visual
 * linkage badge when multiple frames render the same screen.
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
    let maxX = 0;
    let maxY = 0;
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cursorMode !== "hand") return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
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
    e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
  };

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
          cursorMode === "hand" ? (panRef.current ? "grabbing" : "grab") : "default",
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
            frame={frame}
            presets={DEFAULT_PRESETS}
            sharedCount={sharedScreenCounts[frame.screen] ?? 1}
          />
        ))}
      </div>
    </div>
  );
}

const DEFAULT_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];
