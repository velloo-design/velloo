/**
 * Selection handles, drawn on the board over the selected node.
 *
 * Direct manipulation and the HUD's number field are the same edit: both write
 * the node's width/height slot, so dragging a corner and typing a value stay in
 * agreement rather than being two competing notions of size. The drag writes
 * continuously, throttled — Tailwind's arbitrary values only exist once the
 * server has compiled them, so a locally-faked preview would be a different
 * design than the one being dragged towards. Every write in a drag carries the
 * same gesture id, which is what collapses the whole pull into one undo step.
 *
 * Writing mid-drag means the frame reloads under the pointer, which takes the
 * grips' DOM nodes with it — so the gesture is tracked on `window` rather than
 * through pointer capture on a button that won't survive the first tick, and
 * the boxes it draws are frozen at pointer-down so the handles don't chase a
 * settling layout.
 *
 * The selection box is drawn here too, square-cornered. It used to be the
 * iframe's own CSS outline on the element, which can't go stale the way a
 * reported rect can — but an outline follows the element's border-radius,
 * while the grips mark the bounding box a resize drag actually operates on.
 * On a radius-6 row at 320% zoom the corner grips sat 5.6px outside the
 * visible line (the gap is radius x 0.29 x zoom), reading as handles that had
 * come loose. A square box costs a frame of lag after a reflow and buys grips
 * that land on it at any radius. Hover is still the iframe's outline: it has
 * no handles to agree with, and hugging the real shape suits a transient cue.
 *
 * A snippet definition renders once per instance and every instance shows a
 * box — that is the scope of the edit — but only the instance that was clicked
 * carries grips. Eight handles on each of 41 instances is not a selection.
 */

import { SELECT_RING, SELECT_RING_SNIPPET } from "@velloo/renderer/iframe-protocol";
import { useEffect, useRef, useState } from "react";
import { mutate } from "../../api.ts";
import { useEditCommit } from "../../hooks/useEditCommit.ts";
import { type SelectionRect, useSelectionRects } from "../../hooks/useSelectionRects.ts";
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

/** Grip edge in screen px — kept constant whatever the board zoom is. */
const GRIP = 7;

/**
 * How often a drag is allowed to write. Each write re-renders the screen, so
 * this trades some smoothness for a preview that is the real compiled design.
 */
const THROTTLE_MS = 90;

interface Drag {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  sx: number;
  sy: number;
  zoom: number;
  gesture: string;
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
  // The boxes to draw against for the length of a drag. Rects re-arrive on
  // every write, and letting the grips follow them would make them jitter
  // against the element they're resizing.
  const frozen = useRef<SelectionRect[]>([]);

  const push = useEditCommit<{
    screenId: string;
    path: string;
    classes: string;
    gesture: string;
  }>(THROTTLE_MS, (p) => {
    void mutate
      .applyClasses({
        screenId: p.screenId,
        path: pathFromString(p.path),
        classes: p.classes,
        gesture: p.gesture,
      })
      .catch((err) => toastError(err, "Could not resize"));
  });

  // Every write in a drag is the absolute size, so a throttle that drops
  // intermediate ticks loses nothing — the last one is the whole answer. The
  // pointer handlers live on `window` and outlive this render, so they reach
  // the current node and selection through a ref rather than a closure.
  const writeRef = useRef<(d: Drag, w: number, h: number) => void>(() => {});
  writeRef.current = (d, w, h) => {
    if (!selection || !node) return;
    let classes = classNameOf(node);
    if (d.sx !== 0) classes = applyStyleValue(classes, "width", `[${Math.round(w)}px]`);
    if (d.sy !== 0) classes = applyStyleValue(classes, "height", `[${Math.round(h)}px]`);
    push({ screenId: selection.screenId, path: selection.path, classes, gesture: d.gesture }, true);
  };

  // A drag that started is finished on `window`: the grip it began on is gone
  // as soon as the first write reloads the frame, so neither the element nor
  // its pointer capture can be relied on to see the gesture through.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // Pointer deltas are in screen px; the board is scaled.
      const dx = ((e.clientX - d.startX) / d.zoom) * d.sx;
      const dy = ((e.clientY - d.startY) / d.zoom) * d.sy;
      const next = { w: Math.max(8, d.startW + dx), h: Math.max(8, d.startH + dy) };
      setLive(next);
      writeRef.current(d, next.w, next.h);
    };
    const up = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setLive((last) => {
        // The throttle may still be holding the last tick; re-send it so where
        // the pointer stopped is where the node ends up.
        if (last) writeRef.current(d, last.w, last.h);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  if (!selection || !node) return null;
  if (cursorMode !== "select" || !wsConnected) return null;

  if (rects.length > 0 && drag.current === null) frozen.current = rects;
  const shown = drag.current !== null || live !== null ? frozen.current : rects;
  if (shown.length === 0) return null;

  // A snippet instance selects as a different kind of thing — editing it moves
  // every other instance — so it gets its own colour. Box and grips share it,
  // so they read as one piece of chrome.
  const ring = "$snippet" in node ? SELECT_RING_SNIPPET : SELECT_RING;

  // Handles are chrome: they keep their pixel size whatever the board zoom is.
  const s = 1 / zoom;

  return (
    <div className="pointer-events-none absolute inset-0" data-velloo-selection-layer>
      {shown.map((rect) => {
        const w = live && rect.anchor ? live.w : rect.w;
        const h = live && rect.anchor ? live.h : rect.h;
        return (
          // Rects are measured against the frame's iframe viewport, so a node
          // scrolled out of view reports a box beyond the frame. Clipping to
          // the viewport keeps the chrome inside the frame it belongs to
          // instead of floating over the board.
          <div
            key={rect.key}
            className="absolute overflow-hidden"
            style={{
              left: rect.clip.x,
              top: rect.clip.y,
              width: rect.clip.w,
              height: rect.clip.h,
            }}
          >
            <div
              className="absolute"
              style={{ left: rect.x - rect.clip.x, top: rect.y - rect.clip.y, width: w, height: h }}
            >
              {/* Square corners, whatever the element's radius: the grips sit on
                this box, and a box that traced the shape would leave them
                stranded in the gap outside each rounded corner. */}
              <div
                className="absolute inset-0"
                data-velloo-selection-box
                style={{ outline: `${2 * s}px solid ${ring}`, outlineOffset: -2 * s }}
              />
              {live && rect.anchor ? (
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
              {rect.anchor
                ? HANDLES.map((handle) => (
                    <button
                      key={handle.id}
                      type="button"
                      aria-label={`Resize ${handle.id}`}
                      // Solid squares in the ring's own colour, centred on the ring's
                      // corners and edge midpoints — the grips read as part of the
                      // selection outline rather than as separate dots on top of it.
                      className="pointer-events-auto absolute rounded-none"
                      style={{
                        left: handle.x * w,
                        top: handle.y * h,
                        width: GRIP * s,
                        height: GRIP * s,
                        marginLeft: (-GRIP / 2) * s,
                        marginTop: (-GRIP / 2) * s,
                        background: ring,
                        cursor: handle.cursor,
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Capture, *and* window listeners. Capture is what keeps the
                        // events coming once the pointer crosses onto the iframe —
                        // without it the child document swallows every move and up,
                        // so the drag froze on its first tick and never ended. The
                        // listeners are on `window` because the grip itself may be
                        // replaced by a re-render mid-drag; captured events still
                        // bubble there from the parent document.
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = {
                          startX: e.clientX,
                          startY: e.clientY,
                          startW: rect.w,
                          startH: rect.h,
                          sx: handle.sx,
                          sy: handle.sy,
                          zoom,
                          // One id for the whole pull, so the stream of writes it
                          // makes is a single act to undo.
                          gesture: `resize-${e.pointerId}-${Date.now()}`,
                        };
                        setLive({ w: rect.w, h: rect.h });
                      }}
                    />
                  ))
                : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
