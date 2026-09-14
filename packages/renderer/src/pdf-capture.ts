import type { Viewport } from "@velloo/schema";
import { CAPTURE_TIMEOUT_MS, withContext } from "./browser-pool.ts";
import { settleForCapture, waitForFonts, waitForLiveIslands } from "./capture-settle.ts";
import { escapeHtml } from "./document.ts";

export interface PdfPageOptions {
  html: string;
  viewport: Viewport;
  /**
   * Grow the page to the full content height (fullPage semantics, mirroring the
   * screenshot pipeline's default) so nothing clips — every frame stays a
   * single PDF page. Pass `false` to clip at the viewport rectangle instead.
   */
  fullPage?: boolean;
  /** Small name chip overlaid bottom-left (deck pages carry the frame/screen name). */
  label?: string;
}

/**
 * Render HTML to a single-page PDF via Chromium's native `page.pdf`. Media
 * stays emulated as `screen` (print stylesheets would strip the design's
 * backgrounds) and `printBackground` is on, so the page prints exactly what
 * the screenshot path rasterizes — same settle (load + webfonts + live
 * islands), so webfonts are resolved before printing.
 */
export async function pdfPageBuffer(opts: PdfPageOptions): Promise<Buffer> {
  return withContext(
    { viewport: { width: opts.viewport.w, height: opts.viewport.h } },
    async (context) => {
      const page = await context.newPage();
      await page.emulateMedia({ media: "screen" });
      await page.setContent(opts.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_TIMEOUT_MS,
      });
      await settleForCapture(page, opts.html);
      const fullPage = opts.fullPage ?? true;
      const height = fullPage
        ? Math.max(
            opts.viewport.h,
            await page
              .evaluate(() => document.documentElement.scrollHeight)
              .catch(() => opts.viewport.h),
          )
        : opts.viewport.h;
      if (opts.label) {
        await page.evaluate((label) => {
          const el = document.createElement("div");
          el.textContent = label;
          el.style.cssText =
            "position:fixed;left:12px;bottom:12px;z-index:2147483647;" +
            "font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fafafa;" +
            "background:rgba(24,24,27,.85);padding:6px 10px;border-radius:8px";
          document.body.appendChild(el);
        }, opts.label);
      }
      // pageRanges "1": with fullPage the measured height makes one page anyway
      // (this guards a rounding sliver); with fullPage: false it IS the clip.
      return await page.pdf({
        width: `${opts.viewport.w}px`,
        height: `${height}px`,
        printBackground: true,
        pageRanges: "1",
      });
    },
  );
}

/**
 * Multi-page PDF deck: one page per entry, in order, each page sized to its
 * own viewport (a review/handoff deck — a board's frames in board order).
 * One print job: each entry's full HTML doc is embedded as a same-origin
 * iframe in a wrapper document whose sections carry CSS *named pages*
 * (`page: pN` + `@page pN { size … }`) — modern Chromium honors a distinct
 * size per named page, so no per-entry print + pdf-lib merge is needed.
 * Heights follow `fullPage` semantics: after the iframes load and settle,
 * each iframe (and its named page) grows to its content height, so an entry
 * is always exactly one page.
 */
export async function pdfDeckBuffer(pages: PdfPageOptions[]): Promise<Buffer> {
  const first = pages[0];
  if (!first) throw new Error("pdfDeckBuffer: no pages");
  if (pages.length === 1) return pdfPageBuffer(first);
  const wrapper = buildDeckWrapper(pages);
  const maxW = Math.max(...pages.map((p) => p.viewport.w));
  const maxH = Math.max(...pages.map((p) => p.viewport.h));
  return withContext({ viewport: { width: maxW, height: maxH } }, async (context) => {
    const page = await context.newPage();
    await page.emulateMedia({ media: "screen" });
    await page.setContent(wrapper, { waitUntil: "domcontentloaded", timeout: CAPTURE_TIMEOUT_MS });
    // Every entry iframe loaded (ready flags, bounded like the compare wrapper).
    await page
      .waitForFunction(
        (count) => {
          for (let i = 0; i < count; i++) {
            const f = document.getElementById(`f${i}`);
            if (!(f instanceof HTMLIFrameElement) || f.dataset.ready !== "1") return false;
          }
          return true;
        },
        pages.length,
        { timeout: CAPTURE_TIMEOUT_MS },
      )
      .catch(() => {});
    // Fonts + live islands live inside the child frames, not the top document.
    await settleForCapture(page, wrapper, { liveIslands: false });
    await Promise.all(
      page
        .frames()
        .filter((f) => f !== page.mainFrame())
        .map(async (frame) => {
          const entry = pages[Number(frame.name().slice(1))];
          await waitForFonts(frame);
          if (entry) await waitForLiveIslands(frame, entry.html);
        }),
    );
    // Now that content has settled, measure each iframe and size it together
    // with its named page (same one-shot measure as pdfPageBuffer). Each
    // section's height matches its page box exactly in CSS px, so nothing
    // fragments onto a stray extra page.
    await page.evaluate(
      (entries) => {
        const rules: string[] = [];
        entries.forEach((e, i) => {
          const f = document.getElementById(`f${i}`);
          const section = document.getElementById(`s${i}`);
          if (!(f instanceof HTMLIFrameElement) || !(section instanceof HTMLElement)) return;
          const content = f.contentDocument?.documentElement?.scrollHeight ?? e.h;
          const height = e.fullPage ? Math.max(e.h, content) : e.h;
          f.height = String(height);
          section.style.height = `${height}px`;
          rules.push(`@page p${i}{size:${e.w}px ${height}px;margin:0}`);
        });
        const style = document.getElementById("deck-pages");
        if (style) style.textContent = rules.join("\n");
      },
      pages.map((p) => ({ w: p.viewport.w, h: p.viewport.h, fullPage: p.fullPage ?? true })),
    );
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  });
}

/**
 * The single-print-job deck document: one section per entry, each a
 * same-origin srcdoc iframe on its own CSS named page. `@page` sizes here are
 * the pre-measure viewports — `pdfDeckBuffer` rewrites `#deck-pages` after the
 * frames settle and are measured. The label chip is *absolutely* positioned
 * inside its section (a `position: fixed` chip would repeat on every page of
 * the print job). Iframes start at the entry viewport height — never measure
 * from the 150px iframe default, because viewport-bound layouts (h-screen
 * roots) size themselves to whatever the iframe is; grow only on genuine
 * overflow (see buildCompareWrapper for the same rationale).
 */
function buildDeckWrapper(pages: PdfPageOptions[]): string {
  const styles = [
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0}",
    // Named pages alone force a break between differently named sections;
    // break-after is belt and braces (skipping the last avoids a blank tail page).
    "section{position:relative;overflow:hidden}",
    "section:not(:last-of-type){break-after:page}",
    "iframe{border:0;display:block;background:#fff}",
    ".chip{position:absolute;left:12px;bottom:12px;z-index:2147483647;" +
      "font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fafafa;" +
      "background:rgba(24,24,27,.85);padding:6px 10px;border-radius:8px}",
  ].join("");
  const pageRules = pages
    .map((p, i) => `@page p${i}{size:${p.viewport.w}px ${p.viewport.h}px;margin:0}`)
    .join("\n");
  const sections = pages
    .map((p, i) => {
      const { w, h } = p.viewport;
      const chip = p.label ? `<div class="chip">${escapeHtml(p.label)}</div>` : "";
      return (
        `<section id="s${i}" style="page:p${i};width:${w}px;height:${h}px">` +
        `<iframe id="f${i}" name="f${i}" width="${w}" height="${h}" srcdoc="${escapeHtml(p.html)}"></iframe>${chip}</section>`
      );
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${styles}</style><style id="deck-pages">${pageRules}</style></head>
<body>
${sections}
<script>
for (let i = 0; i < ${pages.length}; i++) {
  const f = document.getElementById("f" + i);
  f.addEventListener("load", () => { f.dataset.ready = "1"; });
}
</script>
</body></html>`;
}
