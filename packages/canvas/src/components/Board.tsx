import type { Board as BoardT } from "@velloo/schema";
import { useCanvas } from "../store.ts";
import { Frame } from "./Frame.tsx";

interface BoardProps {
  board: BoardT;
}

/**
 * The infinite canvas. Frames are absolutely positioned in board coordinates;
 * a pan+zoom transform wraps the whole world.
 *
 * Sprint A ships the minimum viable Board — frames render at their stored
 * (x, y, w, h). Sprint D adds drag-resize, snap-to-preset, group regions,
 * pan/zoom polish, and visual linkage between frames of the same screen.
 */
export function Board({ board }: BoardProps) {
  const zoom = useCanvas((s) => s.canvasZoom);
  const pan = useCanvas((s) => s.pan);

  // World bounds: extend a bit beyond the rightmost / bottommost frame.
  let maxX = 0;
  let maxY = 0;
  for (const f of board.frames) {
    if (f.x + f.w > maxX) maxX = f.x + f.w;
    if (f.y + f.h > maxY) maxY = f.y + f.h;
  }

  return (
    <div className="flex-1 overflow-auto bg-[var(--color-bg-soft)]">
      <div
        className="relative origin-top-left"
        style={{
          width: maxX + 200,
          height: maxY + 200,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {board.frames.map((frame) => (
          <div
            key={frame.id}
            className="absolute"
            style={{ left: frame.x, top: frame.y }}
            data-frame-id={frame.id}
            data-group-id={frame.group ?? ""}
          >
            <Frame frame={frame} />
          </div>
        ))}
      </div>
    </div>
  );
}
