import type { Page } from "@velloo/schema";
import { useEffect, useRef } from "react";
import { mutate } from "../api.ts";
import { useCanvas } from "../store.ts";
import { VariantFrame } from "./VariantFrame.tsx";

interface Props {
  pageId: string;
  page: Page;
}

type DragState =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
    }
  | {
      kind: "variant";
      startX: number;
      startY: number;
      variantId: string;
      basePos: { x: number; y: number };
      preview: { x: number; y: number } | null;
      el: HTMLElement;
    };

function isPositioned(page: Page): boolean {
  return page.variants.some((v) => v.position !== undefined);
}

/** Auto-flow fallback for a variant that doesn't yet have an explicit position. */
function defaultPositionFor(page: Page, variantId: string): { x: number; y: number } {
  let x = 0;
  for (const v of page.variants) {
    if (v.id === variantId) return { x, y: 0 };
    x += v.viewport.w + 48;
  }
  return { x: 0, y: 0 };
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * The canvas surface. Huge inner padding → infinite-feeling scroll. Two
 * layout modes: flow (default) and free (any variant has an explicit
 * position; dragging the frame header commits a new position).
 */
export function VariantGrid({ pageId, page }: Props) {
  const canvasZoom = useCanvas((s) => s.canvasZoom);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setCanvasZoom = useCanvas((s) => s.setCanvasZoom);

  const outerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const positioned = isPositioned(page);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return undefined;

    const findFrameEl = (variantId: string): HTMLElement | null => {
      const header = el.querySelector(
        `.velloo-variant-header[data-variant-id="${cssEscape(variantId)}"]`,
      );
      return (header?.parentElement as HTMLElement) ?? null;
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const header = target.closest(".velloo-variant-header") as HTMLElement | null;
      const overInteractive = target.closest("input,textarea,button");

      // Variant drag: only in select mode and only on the header background
      // (not on the inline button/inputs the header contains).
      if (header && !overInteractive && cursorMode !== "hand") {
        e.preventDefault();
        const variantId = header.getAttribute("data-variant-id");
        const v = page.variants.find((x) => x.id === variantId);
        if (!variantId || !v) return;
        const frameEl = findFrameEl(variantId);
        if (!frameEl) return;
        dragRef.current = {
          kind: "variant",
          startX: e.clientX,
          startY: e.clientY,
          variantId,
          basePos: v.position ?? defaultPositionFor(page, variantId),
          preview: null,
          el: frameEl,
        };
        document.body.style.cursor = "grabbing";
        return;
      }

      if (cursorMode === "hand") {
        e.preventDefault();
        dragRef.current = {
          kind: "pan",
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: el.scrollLeft,
          scrollTop: el.scrollTop,
        };
        el.style.cursor = "grabbing";
      }
    };

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "pan") {
        el.scrollLeft = d.scrollLeft - (e.clientX - d.startX);
        el.scrollTop = d.scrollTop - (e.clientY - d.startY);
        return;
      }
      const z = useCanvas.getState().canvasZoom || 1;
      const dx = (e.clientX - d.startX) / z;
      const dy = (e.clientY - d.startY) / z;
      d.preview = { x: Math.round(d.basePos.x + dx), y: Math.round(d.basePos.y + dy) };
      // Apply an optimistic visual transform on the frame; the WS broadcast
      // brings canonical state back on commit and clears the transform.
      d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = "";
      el.style.cursor = cursorMode === "hand" ? "grab" : "";
      if (d?.kind === "variant" && d.preview) {
        d.el.style.transform = "";
        void mutate
          .updateVariant({
            pageId,
            variantId: d.variantId,
            patch: { position: d.preview },
          })
          .catch(() => undefined);
      }
    };

    el.style.cursor = cursorMode === "hand" ? "grab" : "";
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      el.style.cursor = "";
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [cursorMode, page, pageId]);

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

  // Center the scroll on the variants on page change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageId is the trigger
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const z = useCanvas.getState().canvasZoom;
    el.scrollLeft = 3000 * z - 24;
    el.scrollTop = 3000 * z - 24;
  }, [pageId]);

  const wrapperClass =
    "flex-1 overflow-auto bg-[var(--color-bg)] relative" +
    (cursorMode === "hand" ? " velloo-hand" : "");

  return (
    <div ref={outerRef} className={wrapperClass}>
      <div
        className="origin-top-left will-change-transform inline-block"
        style={{ transform: `scale(${canvasZoom})`, transformOrigin: "top left" }}
      >
        <div className="relative" style={{ padding: "3000px", minWidth: 6000, minHeight: 6000 }}>
          {positioned ? (
            page.variants.map((v) => {
              const pos = v.position ?? defaultPositionFor(page, v.id);
              return (
                <div
                  key={`${pageId}/${v.id}`}
                  className="absolute"
                  style={{ left: pos.x, top: pos.y }}
                >
                  <VariantFrame
                    pageId={pageId}
                    variantId={v.id}
                    variantName={v.name}
                    viewport={v.viewport}
                    positioned
                  />
                </div>
              );
            })
          ) : (
            <div className="flex items-start gap-12">
              {page.variants.map((v) => (
                <VariantFrame
                  key={`${pageId}/${v.id}`}
                  pageId={pageId}
                  variantId={v.id}
                  variantName={v.name}
                  viewport={v.viewport}
                  positioned={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
