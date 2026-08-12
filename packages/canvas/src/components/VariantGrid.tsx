import type { Page, Variant } from "@velloo/schema";
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

const VARIANT_GAP = 48;
/** Bounding box variants must stay within. The .relative positioning context
 * sits at scroll coord (3000, 3000), inside a 6000×6000 padded surface — so
 * a variant's top-left can run from -3000 (visible at the left edge of the
 * scroll area) up to 3000 minus its own width (right edge of the surface). */
const CANVAS_MIN = -3000;
const CANVAS_MAX = 3000;

function clampPosition(
  pos: { x: number; y: number },
  size: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.max(CANVAS_MIN, Math.min(CANVAS_MAX - size.w, pos.x)),
    y: Math.max(CANVAS_MIN, Math.min(CANVAS_MAX - size.h, pos.y)),
  };
}

function isPositioned(page: Page): boolean {
  return page.variants.some((v) => v.position !== undefined);
}

/** Auto-flow fallback for a variant that doesn't yet have an explicit position. */
function defaultPositionFor(page: Page, variantId: string): { x: number; y: number } {
  let x = 0;
  for (const v of page.variants) {
    if (v.id === variantId) return { x, y: 0 };
    x += v.viewport.w + VARIANT_GAP;
  }
  return { x: 0, y: 0 };
}

/** Effective position used for rendering (explicit or auto-flow). */
function effectivePosition(page: Page, v: Variant): { x: number; y: number } {
  return v.position ?? defaultPositionFor(page, v.id);
}

/**
 * Push `dragged` horizontally until it no longer overlaps any other variant
 * on the page. Snaps to whichever side of the obstacle is closer to the
 * drop point. Y is preserved.
 */
function resolveCollision(
  page: Page,
  dragged: Variant,
  drop: { x: number; y: number },
): { x: number; y: number } {
  const w = dragged.viewport.w;
  const h = dragged.viewport.h;
  // Iterate until stable — each pass may surface a new collision.
  let { x, y } = drop;
  for (let pass = 0; pass < page.variants.length + 1; pass++) {
    let collided = false;
    for (const other of page.variants) {
      if (other.id === dragged.id) continue;
      const op = effectivePosition(page, other);
      const ow = other.viewport.w;
      const oh = other.viewport.h;
      const overlapX = x < op.x + ow && x + w > op.x;
      const overlapY = y < op.y + oh && y + h > op.y;
      if (!overlapX || !overlapY) continue;
      collided = true;
      // Snap to the side that's closer to the drop point.
      const leftCandidate = op.x - w - VARIANT_GAP;
      const rightCandidate = op.x + ow + VARIANT_GAP;
      const distLeft = Math.abs(x - leftCandidate);
      const distRight = Math.abs(x - rightCandidate);
      x = distLeft < distRight ? leftCandidate : rightCandidate;
      break;
    }
    if (!collided) break;
  }
  return { x, y };
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
  const lastZoomRef = useRef(canvasZoom);

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
      // Drag only initiates from the explicit handle icon — other header
      // affordances (size text, kebab menu) keep their own click behavior.
      const handle = target.closest(".velloo-variant-handle") as HTMLElement | null;

      if (handle && cursorMode !== "hand") {
        e.preventDefault();
        const variantId = handle.getAttribute("data-variant-id");
        const v = page.variants.find((x) => x.id === variantId);
        if (!variantId || !v) return;
        const frameEl = findFrameEl(variantId);
        if (!frameEl) return;
        dragRef.current = {
          kind: "variant",
          startX: e.clientX,
          startY: e.clientY,
          variantId,
          basePos: effectivePosition(page, v),
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
      const dragged = page.variants.find((x) => x.id === d.variantId);
      if (!dragged) return;
      const z = useCanvas.getState().canvasZoom || 1;
      const rawDx = (e.clientX - d.startX) / z;
      const rawDy = (e.clientY - d.startY) / z;
      const rawPos = { x: Math.round(d.basePos.x + rawDx), y: Math.round(d.basePos.y + rawDy) };
      // Resolve collision + clamp live so the visible frame matches the
      // resolved drop slot at all times.
      const collision = resolveCollision(page, dragged, rawPos);
      const clamped = clampPosition(collision, dragged.viewport);
      d.preview = clamped;
      const dx = clamped.x - d.basePos.x;
      const dy = clamped.y - d.basePos.y;
      d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = "";
      el.style.cursor = cursorMode === "hand" ? "grab" : "";
      if (d?.kind !== "variant" || !d.preview) return;
      d.el.style.transform = "";

      // d.preview already carries the resolved + clamped position (computed
      // live in onMove), so the commit uses it directly.
      const resolved = d.preview;

      // Backfill positions for every variant that doesn't yet have one (not
      // just on the first drag — new variants added later need this too).
      // Their auto-flow slot is captured so they don't drift when the page
      // re-renders in positioned mode.
      const promotionPatches: Promise<unknown>[] = [];
      for (const other of page.variants) {
        if (other.id === d.variantId) continue;
        if (other.position !== undefined) continue;
        const auto = defaultPositionFor(page, other.id);
        promotionPatches.push(
          mutate
            .updateVariant({
              pageId,
              variantId: other.id,
              patch: { position: auto },
            })
            .catch(() => undefined),
        );
      }

      promotionPatches.push(
        mutate
          .updateVariant({
            pageId,
            variantId: d.variantId,
            patch: { position: resolved },
          })
          .catch(() => undefined),
      );
      void Promise.all(promotionPatches);
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

  // Pinch zoom (trackpad) / ⌘+wheel always drive the canvas zoom, regardless
  // of where the cursor is over our window — otherwise the browser would
  // page-zoom whenever the cursor sits on a pane or an iframe. Anchor on the
  // cursor when it's over the canvas, on the canvas center otherwise.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = outerRef.current;
      if (!el) return;
      const delta = -e.deltaY * 0.002;
      const before = useCanvas.getState().canvasZoom;
      const next = Math.max(0.1, Math.min(4, before + delta));
      if (next === before) return;
      const rect = el.getBoundingClientRect();
      // Cursor inside the canvas? anchor on cursor; otherwise on its center.
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      const cx = inside ? e.clientX - rect.left : rect.width / 2;
      const cy = inside ? e.clientY - rect.top : rect.height / 2;
      const ratio = next / before;
      el.scrollLeft = (el.scrollLeft + cx) * ratio - cx;
      el.scrollTop = (el.scrollTop + cy) * ratio - cy;
      lastZoomRef.current = next;
      setCanvasZoom(next);
    };
    // Capture-phase + non-passive so we beat the browser to preventDefault
    // even when the event fires over a child pane.
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
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

  // Anchor scroll on the visible viewport center for any zoom change that
  // didn't already anchor itself (TopBar +/-, ⌘0 reset). Wheel zoom
  // pre-stamps lastZoomRef so this effect is a no-op for that path.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) {
      lastZoomRef.current = canvasZoom;
      return;
    }
    const prev = lastZoomRef.current;
    if (prev === canvasZoom) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const ratio = canvasZoom / prev;
    el.scrollLeft = (el.scrollLeft + cx) * ratio - cx;
    el.scrollTop = (el.scrollTop + cy) * ratio - cy;
    lastZoomRef.current = canvasZoom;
  }, [canvasZoom]);

  const wrapperClass =
    "flex-1 overflow-auto bg-[var(--color-bg)] relative" +
    (cursorMode === "hand" ? " velloo-hand" : "");

  return (
    <div ref={outerRef} className={wrapperClass}>
      <div
        className="origin-top-left will-change-transform inline-block"
        style={{ transform: `scale(${canvasZoom})`, transformOrigin: "top left" }}
      >
        {/* Outer box reserves the huge scrollable area; the inner .relative is
            the absolute-positioning context so positioned variants render at
            (0,0) inside the same coordinate frame the flow layout uses. */}
        <div style={{ padding: "3000px", minWidth: 6000, minHeight: 6000 }}>
          <div className="relative">
            {positioned ? (
              page.variants.map((v) => {
                const pos = effectivePosition(page, v);
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
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
