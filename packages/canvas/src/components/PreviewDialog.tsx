import type { ViewportPreset } from "@velloo/schema";
import { useEffect, useRef, useState } from "react";
import { previewRenderSrc } from "../frame-render-src.ts";
import { useCanvas } from "../store.ts";
import { PendingRender } from "./PendingRender.tsx";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

const MIN_W = 240;
const MAX_W = 4096;

const FALLBACK_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];

function clampW(n: number): number {
  return Math.max(MIN_W, Math.min(MAX_W, Math.round(n)));
}

/**
 * Near-fullscreen preview of one screen with an adjustable render width
 * the "how does this variant read at 1200px?" loop without
 * touching the board layout. The iframe embeds the same /api/render URL the
 * board frames use (board theme + design dark/light respected); dragging the
 * side handles stretches live and re-renders at the committed width on
 * release. Strictly read-only: nothing here writes frame geometry back.
 */
export function PreviewDialog() {
  const target = useCanvas((s) => s.previewTarget);
  const setTarget = useCanvas((s) => s.setPreviewTarget);
  const designMode = useCanvas((s) => s.designMode);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const screenRev = useCanvas((s) => (target ? (s.screenVersions[target.screenId] ?? 0) : 0));
  const presets = useCanvas((s) => {
    const fromConfig = s.design?.viewportPresets;
    return fromConfig && fromConfig.length > 0 ? fromConfig : FALLBACK_PRESETS;
  });

  // `width` is the committed render width (feeds the iframe src); `draftWidth`
  // is the live drag value that only stretches the element, so a drag doesn't
  // navigate the iframe on every pointer-move.
  const [width, setWidth] = useState(1200);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const [renderH, setRenderH] = useState(900);
  // First render of the opened screen only: a width commit re-navigates the
  // iframe, but the browser keeps the previous document painted until the new
  // one arrives, so covering it then would hide a good render.
  const [painted, setPainted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (target) {
      setWidth(clampW(target.w));
      setDraftWidth(null);
      setPainted(false);
    }
  }, [target]);

  // The render height fills whatever the modal body offers; taller content
  // scrolls inside the iframe (no channel handshake here, so wheel events
  // stay native).
  useEffect(() => {
    if (!target) return;
    const el = bodyRef.current;
    if (!el) return;
    const report = () => setRenderH(Math.max(200, Math.round(el.clientHeight)));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [target]);

  const startEdgeDrag = (edge: "w" | "e") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const targetEl = e.currentTarget;
    targetEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = draftWidth ?? width;
    const compute = (ev: PointerEvent) => {
      // The preview stays centered, so pulling one edge grows both sides.
      const dx = (ev.clientX - startX) * (edge === "e" ? 2 : -2);
      return clampW(startW + dx);
    };
    const onMove = (ev: PointerEvent) => setDraftWidth(compute(ev));
    const onUp = (ev: PointerEvent) => {
      targetEl.removeEventListener("pointermove", onMove);
      targetEl.removeEventListener("pointerup", onUp);
      targetEl.removeEventListener("pointercancel", onUp);
      setDraftWidth(null);
      setWidth(compute(ev));
    };
    targetEl.addEventListener("pointermove", onMove);
    targetEl.addEventListener("pointerup", onUp);
    targetEl.addEventListener("pointercancel", onUp);
  };

  if (!target) return null;

  const effectiveW = draftWidth ?? width;
  const src = previewRenderSrc({
    screenId: target.screenId,
    width,
    height: renderH,
    ...(target.boardTheme ? { boardTheme: target.boardTheme } : {}),
    ...(target.scheme ? { scheme: target.scheme } : {}),
    canvasDefault: designMode,
    screenRevision: screenRev,
    themeVersion,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent className="max-w-none sm:max-w-none w-[96vw] h-[94vh] flex flex-col gap-3 p-4 bg-card">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-10">
          <DialogTitle className="text-sm truncate">{target.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Full-screen preview with adjustable width
          </DialogDescription>
          <div className="ml-auto flex items-center gap-1.5">
            {presets.map((p) => (
              <Button
                key={p.name}
                variant={width === p.w && draftWidth === null ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setDraftWidth(null);
                  setWidth(clampW(p.w));
                }}
              >
                {p.name} <span className="text-muted-foreground tabular-nums">{p.w}</span>
              </Button>
            ))}
            <WidthInput value={effectiveW} onCommit={(v) => setWidth(clampW(v))} />
          </div>
        </DialogHeader>
        {/* Distinct, darker well around the preview so the rendered design
            reads as its own surface; the padding gives it breathing room. */}
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border bg-muted px-4 py-5">
          <div
            ref={bodyRef}
            className="relative mx-auto h-full group/preview"
            style={{ width: effectiveW, minWidth: effectiveW }}
          >
            <iframe
              title={`Preview: ${target.name}`}
              src={src}
              onLoad={() => setPainted(true)}
              className="h-full w-full border rounded-md bg-white"
              style={{ pointerEvents: draftWidth === null ? "auto" : "none" }}
            />
            {painted ? null : <PendingRender size={40} />}
            <div
              onPointerDown={startEdgeDrag("w")}
              className="absolute top-0 left-0 h-full w-1.5 -translate-x-1 cursor-ew-resize rounded opacity-0 group-hover/preview:opacity-100 transition-opacity bg-primary/40 hover:bg-primary/70"
              role="presentation"
            />
            <div
              onPointerDown={startEdgeDrag("e")}
              className="absolute top-0 right-0 h-full w-1.5 translate-x-1 cursor-ew-resize rounded opacity-0 group-hover/preview:opacity-100 transition-opacity bg-primary/40 hover:bg-primary/70"
              role="presentation"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WidthInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
      <input
        type="number"
        value={draft}
        min={MIN_W}
        max={MAX_W}
        aria-label="preview width"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(String(value));
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="w-14 rounded-sm border bg-transparent px-1 py-0.5 text-right outline-none focus:bg-card [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      px
    </span>
  );
}
