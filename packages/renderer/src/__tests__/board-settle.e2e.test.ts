import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { buildBoardComposite } from "../board-composite.ts";
import { captureScreenshot } from "../screenshot.ts";

/**
 * A composite capture must settle on each FRAME's window, not the top one.
 *
 * Every pane of a board composite is its own document, so the ready flags the
 * live and canvas runtimes set are on its window — the wrapper's are never set
 * at all. A probe of the HTML *string* finds the runtimes' markers inside the
 * frames' `srcdoc` attributes and so waits on the wrapper: out to the full
 * ready timeout, on a flag nothing will ever set, without awaiting a single
 * frame's webfonts, and then shoots whatever the frames have got to. The board
 * composite carries no frame-name or HTML map a caller could settle by, so
 * only settling every frame of the page covers it.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

/** How long each frame's mount takes to commit. Well under any wait budget. */
const MOUNT_DELAY_MS = 250;
const PLACEHOLDER = "rgb(220, 20, 60)";
const MOUNTED = { r: 0, g: 128, b: 0 };

/**
 * A frame document shaped like a real one: it carries the canvas payload
 * element the runtime keys off, paints a placeholder, and only swaps to the
 * mounted colour when it flips `__velloo_canvas_ready` on ITS OWN window.
 */
function frameDoc(label: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:${PLACEHOLDER}">
<div>${label}</div>
<script type="application/json" id="velloo-canvas-data">{"tree":{"ref":"Box"}}</script>
<script>
  setTimeout(function () {
    document.body.style.background = "rgb(${MOUNTED.r}, ${MOUNTED.g}, ${MOUNTED.b})";
    window.__velloo_canvas_ready = true;
  }, ${MOUNT_DELAY_MS});
</script>
</body></html>`;
}

const frames = [
  { frame: { id: "a", screen: "a", x: 0, y: 0, w: 200, h: 150 }, html: frameDoc("A"), label: "A" },
  {
    frame: { id: "b", screen: "b", x: 240, y: 0, w: 200, h: 150 },
    html: frameDoc("B"),
    label: "B",
  },
];

/** The pixel at (x, y) of a decoded capture, as `{ r, g, b }`. */
function pixel(png: PNG, x: number, y: number): { r: number; g: number; b: number } {
  const at = (png.width * y + x) << 2;
  return { r: png.data[at] ?? -1, g: png.data[at + 1] ?? -1, b: png.data[at + 2] ?? -1 };
}

describe.skipIf(!RUN)("board composite capture settles per frame (Playwright)", () => {
  test("shoots the mounted frames, without waiting on the top window's flag", async () => {
    // Exactly what exportBoardPng does: the shared composite builder, then one
    // viewport-clipped capture of it.
    const composite = buildBoardComposite(
      frames.map((entry) => ({ ...entry, frame: entry.frame as never })),
      { labels: true },
    );
    const started = Date.now();
    const { png: bytes } = await captureScreenshot({
      html: composite.html,
      viewport: composite.viewport,
      fullPage: false,
      deviceScaleFactor: 1,
    });
    const elapsed = Date.now() - started;
    const png = PNG.sync.read(bytes);

    // Both panes show what their own mount committed, not the placeholder it
    // replaced. Frames sit at board x + 24px padding, and 24 + 26px of label
    // room down; the 1px iframe border puts content a pixel further in.
    for (const { frame } of frames) {
      expect(pixel(png, frame.x + 24 + 20, 50 + 20)).toEqual(MOUNTED);
    }

    // And it got there by waiting for the frames. Waiting on the top window
    // instead can only end at the ready timeout, which is 12s — a mount that
    // commits in 250ms cannot take seconds unless nobody is watching it.
    expect(elapsed).toBeLessThan(4000);
  }, 30_000);
});
