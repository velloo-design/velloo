/**
 * Selection handles, drawn on the board over the selected node.
 *
 * Direct manipulation and the HUD's number field are the same edit: both write
 * the node's width/height slot, so dragging a corner and typing a value stay in
 * agreement rather than being two competing notions of size. Dragging shows a
 * live readout and only commits on release — a mutation per pointer-move would
 * reload the iframe on every tick.
 *
 * The ring itself is *not* drawn here. The iframe runtime draws it from the
 * element's own box, which can't go stale the way a reported rect can; this
 * layer only adds the grips, whose position is allowed to lag a reflow by a
 * frame.
 */

import { useRef, useState } from "react";
import { mutate } from "../../api.ts";
import { useSelectionRects } from "../../hooks/useSelectionRects.ts";
import { applyStyleValue, classNameOf } from "../../hud/values.ts";
import { pathFromString } from "../../path.ts";
import { selectedNode, useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";

/** Which edges a handle moves. */
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize", sx: -1, sy: -1 },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize", sx: 0, sy: -1 },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize", sx: 1, sy: -1 },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize", sx: 1, sy: 0 },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize", sx: 1, sy: 1 },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize", sx: 0, sy: 1 },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize", sx: -1, sy: 1 },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize", sx: -1, sy: 0 },
] as const;

interface Drag {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  sx: number;
  sy: number;
}

export function SelectionLayer() {
  const rects = useSelectionRects();
  const selection = useCanvas((s) => s.selection);
  const screens = useCanvas((s) => s.screens);
  const zoom = useCanvas((s) => s.canvasZoom);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const node = selection ? selectedNode(screens, selection) : null;

  const drag = useRef<Drag | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);

  if (!selection || !node || rects.length === 0) return null;
  if (cursorMode !== "select" || !wsConnected) return null;

  const isSnippet = "$snippet" in node;
  const ring = isSnippet ? "var(--color-violet-500, #8b5cf6)" : "var(--color-primary)";

  const commit = (w: number, h: number, axis: { w: boolean; h: boolean }) => {
    let classes = classNameOf(node);
    if (axis.w) classes = applyStyleValue(classes, "width", `[${Math.round(w)}px]`);
    if (axis.h) classes = applyStyleValue(classes, "height", `[${Math.round(h)}px]`);
    void mutate
      .applyClasses({
        screenId: selection.screenId,
        path: pathFromString(selection.path),
        classes,
      })
      .catch((err) => toastError(err, "Could not resize"));
  };

  // Handles are chrome: they keep their pixel size whatever the board zoom is.
  const s = 1 / zoom;

  return (
    <div className="pointer-events-none absolute inset-0" data-velloo-selection-layer>
      {rects.map((rect) => {
        const w = live?.w ?? rect.w;
        const h = live?.h ?? rect.h;
        return (
          <div
            key={rect.frameId}
            className="absolute"
            style={{ left: rect.x, top: rect.y, width: w, height: h }}
          >
            {live ? (
              <div
                className="absolute left-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-white tabular-nums"
                style={{
                  top: h + 6 * s,
                  fontSize: 10 * s,
                  background: ring,
                  transform: "translateX(-50%)",
                }}
              >
                {Math.round(live.w)} × {Math.round(live.h)}
              </div>
            ) : null}
            {HANDLES.map((handle) => (
              <button
                key={handle.id}
                type="button"
                aria-label={`Resize ${handle.id}`}
                className="pointer-events-auto absolute rounded-[2px] border bg-background"
                style={{
                  left: handle.x * w,
                  top: handle.y * h,
                  width: 8 * s,
                  height: 8 * s,
                  marginLeft: -4 * s,
                  marginTop: -4 * s,
                  borderWidth: 1.5 * s,
                  borderColor: ring,
                  cursor: handle.cursor,
                }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    startW: rect.w,
                    startH: rect.h,
                    sx: handle.sx,
                    sy: handle.sy,
                  };
                  setLive({ w: rect.w, h: rect.h });
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  // Pointer deltas are in screen px; the board is scaled.
                  const dx = ((e.clientX - d.startX) / zoom) * d.sx;
                  const dy = ((e.clientY - d.startY) / zoom) * d.sy;
                  setLive({
                    w: Math.max(8, d.startW + dx),
                    h: Math.max(8, d.startH + dy),
                  });
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  drag.current = null;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  const next = live;
                  setLive(null);
                  if (!d || !next) return;
                  commit(next.w, next.h, { w: d.sx !== 0, h: d.sy !== 0 });
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
