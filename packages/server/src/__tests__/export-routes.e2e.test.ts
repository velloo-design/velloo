import { afterEach, describe, expect, test } from "bun:test";
import { chromiumExecutable, closePooledBrowser } from "@velloo/renderer";
import { exportRoutesApp } from "./export-routes.fixture.ts";

/** PNG/PDF capture through /api/export, gated on an installed Chromium like the other browser suites. */

const hasChromium = (await chromiumExecutable()) !== null;
const { get } = exportRoutesApp();

describe.if(hasChromium)("PNG/PDF export (chromium)", () => {
  afterEach(async () => {
    await closePooledBrowser();
  });

  test("frame → PNG bytes at the frame viewport", async () => {
    const res = await get("/api/export/frame/f-home.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);

  test("frame → single-page PDF; board → one page per frame in board order, each at its own frame size", async () => {
    const frameRes = await get("/api/export/frame/f-home.pdf");
    expect(frameRes.status).toBe(200);
    expect(frameRes.headers.get("content-type")).toBe("application/pdf");
    const framePdf = Buffer.from(await frameRes.arrayBuffer());
    expect(framePdf.subarray(0, 5).toString()).toBe("%PDF-");

    const boardRes = await get("/api/export/board/main.pdf");
    expect(boardRes.status).toBe(200);
    const boardPdf = Buffer.from(await boardRes.arrayBuffer());
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(framePdf)).getPageCount()).toBe(1);
    const deck = await PDFDocument.load(boardPdf);
    expect(deck.getPageCount()).toBe(2);
    // The deck is a SINGLE Chromium print job with per-named-page CSS sizes;
    // the two frames have different viewports (480×360 vs 800×600), so their
    // pages must come out at different sizes — 0.75pt per CSS px, ±5pt slack
    // for print rounding. Uniform pages would mean Chromium ignored the
    // named-page sizes.
    const first = deck.getPage(0).getSize();
    const second = deck.getPage(1).getSize();
    expect(first.width).toBeCloseTo(480 * 0.75, -1);
    expect(first.height).toBeCloseTo(360 * 0.75, -1);
    expect(second.width).toBeCloseTo(800 * 0.75, -1);
    expect(second.height).toBeCloseTo(600 * 0.75, -1);
  }, 60_000);

  test("board → composite PNG", async () => {
    const res = await get("/api/export/board/main.png?mode=dark");
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);
});
