import type { Page } from "@velloo/schema";
import { useEffect, useRef } from "react";
import { useCanvas } from "../store.ts";
import { VariantFrame } from "./VariantFrame.tsx";

interface Props {
  pageId: string;
  page: Page;
}

/**
 * The variant grid is the only thing that scales + pans. Side panels stay
 * fixed. Two transforms compose:
 *   - translate(pan.x, pan.y) for the hand-mode pan
 *   - scale(canvasZoom)
 * `transform-origin: top left` so zoom math stays predictable.
 */
export function VariantGrid({ pageId, page }: Props) {
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const pan = useCanvas((s) => s.pan);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setPan = useCanvas((s) => s.setPan);
  const setCanvasZoom = useCanvas((s) => s.setCanvasZoom);

  const outerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  // Hand-mode drag-to-pan.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    if (cursorMode !== "hand") return undefined;

    const onDown = (e: MouseEvent) => {
      // Left button only.
      if (e.button !== 0) return;
      dragging.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: useCanvas.getState().pan.x,
        panY: useCanvas.getState().pan.y,
      };
      el.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
    };
    const onUp = () => {
      dragging.current = null;
      el.style.cursor = "grab";
    };

    el.style.cursor = "grab";
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.style.cursor = "";
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [cursorMode, setPan]);

  // ⌘ + scroll → zoom.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setCanvasZoom(useCanvas.getState().canvasZoom + delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setCanvasZoom]);

  // In hand mode, iframes must not capture clicks — a global rule on the
  // outer class disables their pointer-events.
  const wrapperClass =
    "flex-1 overflow-hidden bg-[var(--color-bg)] relative" +
    (cursorMode === "hand" ? " velloo-hand" : "");

  return (
    <div ref={outerRef} className={wrapperClass}>
      <div
        className="origin-top-left will-change-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${canvasZoom})`,
          transformOrigin: "top left",
        }}
      >
        <div className="flex items-start gap-12 p-12 min-w-max">
          {page.variants.map((v) => (
            <VariantFrame
              key={v.id}
              pageId={pageId}
              variantId={v.id}
              variantName={v.name}
              viewport={v.viewport}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
