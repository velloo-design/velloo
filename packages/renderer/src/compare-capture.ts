import type { Viewport } from "@velloo/schema";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { settleForCapture, waitForFonts, waitForLiveIslands } from "./capture-settle.ts";
import { escapeHtml } from "./document.ts";

export interface ScreenshotCompareOptions {
  /** Full HTML doc for the left half (typically light mode). */
  leftHtml: string;
  /** Full HTML doc for the right half (typically dark mode). */
  rightHtml: string;
  viewport: Viewport;
  deviceScaleFactor?: number;
  /** Optional labels rendered above each half. Defaults to "light" / "dark". */
  leftLabel?: string;
  rightLabel?: string;
}

/**
 * Side-by-side render of two HTML docs in a single PNG. Each half is an
 * iframe sized to the variant viewport; the wrapper auto-grows to the
 * taller of the two. Used by the `screenshot mode: "compare"` MCP tool
 * so an agent can verify dark-mode adaptation at a glance without
 * eyeballing two separate PNGs.
 */
export async function screenshotCompareBuffer(opts: ScreenshotCompareOptions): Promise<Buffer> {
  const labelLeft = opts.leftLabel ?? "light";
  const labelRight = opts.rightLabel ?? "dark";
  const w = opts.viewport.w;
  const h = opts.viewport.h;
  const wrapper = buildCompareWrapper(opts.leftHtml, opts.rightHtml, w, h, labelLeft, labelRight);
  return withContext(
    {
      // Width = 2 panels + 1px gutter + horizontal padding; arbitrary tall
      // initial height — we screenshot fullPage so the wrapper grows.
      viewport: { width: w * 2 + 24, height: 800 },
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
    },
    async (context) => {
      const page = await context.newPage();
      await page.setContent(wrapper, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      // Wait until both iframes have measured + the wrapper sized itself.
      // Bounded to CAPTURE_TIMEOUT_MS so a stuck pane can't hang past the
      // capture budget (Playwright's default waitForFunction timeout is 30s).
      await page
        .waitForFunction(
          () => {
            const l = document.getElementById("L") as HTMLIFrameElement | null;
            const r = document.getElementById("R") as HTMLIFrameElement | null;
            return !!(l && r && l.dataset.ready === "1" && r.dataset.ready === "1");
          },
          undefined,
          { timeout: CAPTURE_TIMEOUT_MS },
        )
        .catch(() => {});
      // Islands live in the two child iframes, not the top document.
      await settleForCapture(page, wrapper, { liveIslands: false });
      // `dataset.ready` only says the frame loaded and measured. Fonts, live
      // islands and the framework-native mount all settle *after* that, and
      // each half is its own document — so without this the comparison shot
      // is of two SSR fallbacks in fallback fonts, which is precisely the
      // fidelity the tool exists to judge. Mirrors the deck path's per-frame
      // settle; the deck already did this and compare silently didn't.
      await Promise.all(
        page
          .frames()
          .filter((frame) => frame !== page.mainFrame())
          .map(async (frame) => {
            const html = frame.name() === "R" ? opts.rightHtml : opts.leftHtml;
            await waitForFonts(frame);
            await waitForLiveIslands(frame, html);
          }),
      );
      return await page.screenshot({ fullPage: true, timeout: CAPTURE_TIMEOUT_MS });
    },
  );
}

function buildCompareWrapper(
  leftHtml: string,
  rightHtml: string,
  panelWidth: number,
  panelHeight: number,
  leftLabel: string,
  rightLabel: string,
): string {
  const esc = escapeHtml;
  const styles = [
    "*{box-sizing:border-box}",
    "body{margin:0;padding:8px;background:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif;color:#27272a}",
    ".row{display:flex;gap:8px;align-items:flex-start}",
    ".panel{display:flex;flex-direction:column;gap:4px}",
    ".label{font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#71717a}",
    "iframe{border:1px solid #e4e4e7;background:#fff;display:block}",
  ].join("");
  // Each iframe starts at the requested viewport height — never measure
  // from the 150px iframe default, because viewport-bound layouts
  // (h-screen roots) size themselves to whatever the iframe is, so the
  // scrollHeight probe would just read the default back and "confirm"
  // a sliver. Grow only when content genuinely overflows the viewport.
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${styles}</style></head>
<body>
  <div class="row">
    <div class="panel">
      <div class="label">${esc(leftLabel)}</div>
      <iframe id="L" name="L" width="${panelWidth}" height="${panelHeight}" srcdoc="${esc(leftHtml)}"></iframe>
    </div>
    <div class="panel">
      <div class="label">${esc(rightLabel)}</div>
      <iframe id="R" name="R" width="${panelWidth}" height="${panelHeight}" srcdoc="${esc(rightHtml)}"></iframe>
    </div>
  </div>
  <script>
    function size(id) {
      const f = document.getElementById(id);
      f.addEventListener("load", () => {
        const doc = f.contentDocument;
        if (!doc) { f.dataset.ready = "1"; return; }
        const h = Math.max(${panelHeight}, doc.documentElement.scrollHeight);
        f.height = String(h);
        f.dataset.ready = "1";
      });
    }
    size("L"); size("R");
  </script>
</body></html>`;
}
