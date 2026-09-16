import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { exportRoutesApp } from "./export-routes.fixture.ts";

/**
 * The /api/export routes without a browser: standalone HTML is asserted
 * structurally (self-contained, data-URI assets, no scripts), and lookup and
 * validation errors are covered for every target kind. PNG/PDF capture is in
 * export-routes.e2e.test.ts.
 */

const { get, root } = exportRoutesApp();

describe("standalone HTML export (browser-less)", () => {
  test("screen → self-contained document: data-URI assets, no scripts, no base href", async () => {
    const res = await get("/api/export/screen/home.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain('filename="Home.html"');
    const html = await res.text();
    expect(html).toContain("Welcome home");
    // The referenced asset is embedded, not linked.
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain('src="/assets/');
    // Self-contained: no server base, no runtime/live/canvas scripts at all.
    expect(html).not.toContain("<base");
    expect(html).not.toContain("<script");
  });

  test("dark mode lands on the html element", async () => {
    const res = await get("/api/export/screen/home.html?mode=dark");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="dark"');
  });

  test("frame → its screen at the frame viewport", async () => {
    const res = await get("/api/export/frame/f-home.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="Home-desktop.html"');
    const html = await res.text();
    expect(html).toContain("Welcome home");
    expect(html).toContain("width=480");
  });

  test("board → one composite document with labeled srcdoc iframes", async () => {
    const res = await get("/api/export/board/main.html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect((html.match(/<iframe/g) ?? []).length).toBe(2);
    // Label chips: the explicit frame label, and the screen-name fallback.
    expect(html).toContain("Home / desktop");
    expect(html).toContain("About");
    // The embedded frame docs are themselves inlined (asset data-URI escaped in srcdoc).
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("src=&quot;/assets/");
  });

  test("a missing asset degrades to a warning header, not a failure", async () => {
    await rm(join(root(), "assets/logo.png"));
    const res = await get("/api/export/screen/home.html");
    expect(res.status).toBe(200);
    const warnings = JSON.parse(
      decodeURIComponent(res.headers.get("x-velloo-export-warnings") ?? "[]"),
    ) as string[];
    expect(warnings.some((w) => w.includes("asset not found"))).toBe(true);
  });
});

describe("export route validation", () => {
  test("unknown ids answer 404 per target kind", async () => {
    expect((await get("/api/export/frame/nope.png")).status).toBe(404);
    expect((await get("/api/export/board/nope.png")).status).toBe(404);
    expect((await get("/api/export/screen/nope.html")).status).toBe(404);
  });

  test("bad extension and bad mode answer 400", async () => {
    expect((await get("/api/export/frame/f-home.gif")).status).toBe(400);
    expect((await get("/api/export/frame/f-home.png?mode=sepia")).status).toBe(400);
  });

  test("compare is frame-PNG-only", async () => {
    expect((await get("/api/export/frame/f-home.pdf?mode=compare")).status).toBe(400);
    expect((await get("/api/export/board/main.png?mode=compare")).status).toBe(400);
  });

  test("screen exports are HTML-only on the routes", async () => {
    expect((await get("/api/export/screen/home.png")).status).toBe(400);
  });
});
