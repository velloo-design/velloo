import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { GripVertical, Link2, Monitor, Smartphone, Tablet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mutate, renderUrl } from "../api.ts";
import { IframeChannel } from "../iframe-channel.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";

interface FrameProps {
  boardId: string;
  frame: FrameT;
  otherFrames: FrameT[];
  presets: ViewportPreset[];
  sharedCount: number;
}

const FRAME_PADDING = 16;

/**
 * One placement on the Board: an iframe at the frame's chosen size, rendering
 * the referenced screen. Grab the header to drag; pull the edge handles to
 * resize. Resize clamps against neighboring frames so they never overlap.
 *
 * When the canvas cursor is in `hand` or `note` mode, the iframe's
 * pointer-events are disabled so the parent can capture drag/click through
 * the frame.
 */
export function Frame({ boardId, frame, otherFrames, presets, sharedCount }: FrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const channelRef = useRef<IframeChannel | null>(null);
  const screen = useCanvas((s) => s.screens[frame.screen]);
  const screenVersion = useCanvas((s) => s.screenVersion);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const selection = useCanvas((s) => s.selection);
  const hover = useCanvas((s) => s.hover);
  const designMode = useCanvas((s) => s.designMode);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const setSelection = useCanvas((s) => s.setSelection);
  const setHover = useCanvas((s) => s.setHover);
  const setNodeRects = useCanvas((s) => s.setNodeRects);

  const [draftSize, setDraftSize] = useState<{ w: number; h: number } | null>(null);
  const [draftPos, setDraftPos] = useState<{ x: number; y: number } | null>(null);

  const w = draftSize?.w ?? frame.w;
  const h = draftSize?.h ?? frame.h;
  const x = draftPos?.x ?? frame.x;
  const y = draftPos?.y ?? frame.y;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const channel = new IframeChannel(iframe, {
      onSelect(path) {
        if (path === null) setSelection(null);
        else setSelection({ screenId: frame.screen, path });
      },
      onHover(path) {
        if (path === null) setHover(null);
        else setHover({ screenId: frame.screen, path });
      },
      onRects(rects) {
        setNodeRects(frame.screen, rects);
      },
    });
    channelRef.current = channel;
    const onLoad = () => channel.attach();
    iframe.addEventListener("load", onLoad);
    // Already loaded (hot reload, fast network, etc.) — attach now.
    if (iframe.contentDocument?.readyState === "complete") channel.attach();
    return () => {
      iframe.removeEventListener("load", onLoad);
      channel.destroy();
      channelRef.current = null;
    };
  }, [frame.screen, setSelection, setHover, setNodeRects]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (selection?.screenId === frame.screen) {
      channel.send({ type: "applyHighlight", path: selection.path });
    } else {
      channel.send({ type: "clearHighlight" });
    }
  }, [selection, frame.screen]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    if (hover?.screenId === frame.screen) {
      channel.send({ type: "applyHover", path: hover.path });
    } else {
      channel.send({ type: "clearHover" });
    }
  }, [hover, frame.screen]);

  /** Clamp a candidate resize against neighboring frames so we don't overlap. */
  const clampResize = (nextW: number, nextH: number): { w: number; h: number } => {
    let cw = nextW;
    let ch = nextH;
    for (const other of otherFrames) {
      const ox1 = other.x;
      const oy1 = other.y;
      const ox2 = other.x + other.w;
      const oy2 = other.y + other.h;
      // Other frame to our right + in our vertical lane.
      if (oy1 < frame.y + ch && oy2 > frame.y && ox1 >= frame.x + frame.w - 1) {
        const maxW = ox1 - frame.x - FRAME_PADDING;
        if (maxW < cw) cw = maxW;
      }
      // Other frame below + in our horizontal lane.
      if (ox1 < frame.x + cw && ox2 > frame.x && oy1 >= frame.y + frame.h - 1) {
        const maxH = oy1 - frame.y - FRAME_PADDING;
        if (maxH < ch) ch = maxH;
      }
    }
    return { w: Math.max(120, cw), h: Math.max(120, ch) };
  };

  const startResize = (direction: "e" | "s" | "se") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startW = frame.w;
    const startH = frame.h;
    const startX = e.clientX;
    const startY = e.clientY;
    const zoom = useCanvas.getState().canvasZoom || 1;

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      const rawW = direction === "s" ? startW : Math.round(startW + dx);
      const rawH = direction === "e" ? startH : Math.round(startH + dy);
      return clampResize(rawW, rawH);
    };

    const onMove = (ev: PointerEvent) => {
      setDraftSize(compute(ev));
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const next = compute(ev);
      setDraftSize(null);
      if (next.w !== startW || next.h !== startH) {
        void mutate
          .updateFrame({ boardId, frameId: frame.id, patch: { w: next.w, h: next.h } })
          .catch((err) => toastError(err, "Could not resize frame"));
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  /** Drag the frame around by its header grip handle. */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = frame.x;
    const startY = frame.y;
    const startPx = e.clientX;
    const startPy = e.clientY;
    const zoom = useCanvas.getState().canvasZoom || 1;

    const compute = (ev: PointerEvent) => {
      const dx = (ev.clientX - startPx) / zoom;
      const dy = (ev.clientY - startPy) / zoom;
      return { x: Math.round(startX + dx), y: Math.round(startY + dy) };
    };

    const onMove = (ev: PointerEvent) => {
      setDraftPos(compute(ev));
    };
    const onUp = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const next = compute(ev);
      setDraftPos(null);
      if (next.x !== startX || next.y !== startY) {
        void mutate
          .updateFrame({ boardId, frameId: frame.id, patch: { x: next.x, y: next.y } })
          .catch((err) => toastError(err, "Could not move frame"));
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const onPickPreset = (preset: ViewportPreset) => {
    if (preset.w === frame.w && preset.h === frame.h) return;
    void mutate
      .updateFrame({ boardId, frameId: frame.id, patch: { w: preset.w, h: preset.h } })
      .catch((err) => toastError(err, "Could not resize frame"));
  };

  const onRemove = () => {
    void mutate
      .removeFrame({ boardId, frameId: frame.id })
      .catch((err) => toastError(err, "Could not remove frame"));
  };

  const presetIcon = (preset: ViewportPreset) => {
    if (preset.name.toLowerCase().includes("mobile")) return <Smartphone size={11} />;
    if (preset.name.toLowerCase().includes("tablet")) return <Tablet size={11} />;
    return <Monitor size={11} />;
  };

  const passThrough = cursorMode === "hand" || cursorMode === "note";

  return (
    <div
      className="absolute group"
      style={{ left: x, top: y }}
      data-frame-id={frame.id}
      data-group-id={frame.group ?? ""}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]">
          <div className="flex items-center gap-1 min-w-0">
            <div
              onPointerDown={startDrag}
              className="shrink-0 h-4 w-4 grid place-items-center rounded cursor-grab active:cursor-grabbing text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
              title="Drag to move"
              role="presentation"
            >
              <GripVertical size={12} strokeWidth={2} />
            </div>
            <span className="font-medium truncate">
              {frame.label ?? screen?.name ?? frame.screen}
            </span>
            <span className="opacity-50 tabular-nums">
              {w}×{h}
            </span>
            {sharedCount > 1 ? (
              <span
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                title={`${sharedCount} frames share this screen — edits sync across all of them.`}
              >
                <Link2 size={10} />
                {sharedCount}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4 grid place-items-center rounded hover:bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            title="Remove this frame (the underlying screen stays)"
          >
            <X size={11} />
          </button>
        </div>

        {!screen ? (
          <div
            style={{ width: w, height: h }}
            className="border border-dashed border-[var(--color-fg-muted)]/30 rounded-md grid place-items-center text-xs text-[var(--color-fg-muted)]"
          >
            Loading {frame.screen}…
          </div>
        ) : (
          <div className="relative" style={{ width: w, height: h }}>
            <iframe
              ref={iframeRef}
              title={`${screen.name} (${frame.id})`}
              src={`${renderUrl(frame.screen, w, h)}&mode=${designMode}&v=${screenVersion}.${themeVersion}`}
              width={w}
              height={h}
              className="border border-[var(--color-border)] rounded-md bg-white"
              style={{
                width: w,
                height: h,
                pointerEvents: passThrough ? "none" : "auto",
              }}
            />
            <div
              onPointerDown={startResize("e")}
              className="absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-r-md"
              role="presentation"
            />
            <div
              onPointerDown={startResize("s")}
              className="absolute bottom-0 left-0 w-full h-1.5 -mb-0.5 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-b-md"
              role="presentation"
            />
            <div
              onPointerDown={startResize("se")}
              className="absolute bottom-0 right-0 h-3 w-3 -mb-0.5 -mr-0.5 cursor-nwse-resize opacity-0 group-hover:opacity-100 bg-[var(--color-accent)] rounded-br-md"
              role="presentation"
            />
          </div>
        )}

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {presets.map((preset) => {
            const active = preset.w === frame.w && preset.h === frame.h;
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => onPickPreset(preset)}
                title={`${preset.name}: ${preset.w}×${preset.h}`}
                className={
                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] " +
                  (active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")
                }
              >
                {presetIcon(preset)}
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
