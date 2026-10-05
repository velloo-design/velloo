import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { captureUrlScreenshot } from "../url-capture.ts";

/**
 * A page that only shows itself as it is scrolled: a section revealed on
 * entering the viewport and hidden again on leaving it, an image that loads
 * lazily, and a header that restyles once its top sentinel scrolls away. A
 * full-page shot taken without scrolling has none of the first two in it; one
 * that scrolls and comes back has to keep them and still show the header as
 * the top of the page does.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const REVEAL = `<!doctype html><html><body style="margin:0">
<div id="sentinel" style="height:1px"></div>
<header id="header" style="position:sticky;top:0">header at top</header>
<div style="height:3000px"></div>
<section id="reveal" style="height:200px">section hidden</section>
<div style="height:6000px"></div>
<img id="lazy" loading="lazy" src="/pixel.png" width="10" height="10">
<script>
  const toggle = (id, on, off) => new IntersectionObserver((entries) => {
    for (const entry of entries) document.getElementById(id).textContent = entry.isIntersecting ? on : off;
  });
  toggle("reveal", "section revealed", "section hidden").observe(document.getElementById("reveal"));
  toggle("header", "header at top", "header scrolled").observe(document.getElementById("sentinel"));
</script>
</body></html>`;

/** Grows by two screens every time its end comes into view. */
const ENDLESS = `<!doctype html><html><body style="margin:0">
<main id="feed"><div style="height:600px">row</div></main>
<div id="end" style="height:1px"></div>
<script>
  new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    const row = document.createElement("div");
    row.style.height = "600px";
    row.textContent = "row";
    document.getElementById("feed").append(row);
  }, { rootMargin: "600px" }).observe(document.getElementById("end"));
  addEventListener("scroll", () => {
    const row = document.createElement("div");
    row.style.height = "600px";
    document.getElementById("feed").append(row);
  });
</script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
let imageRequests = 0;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/pixel.png") {
        imageRequests += 1;
        return new Response(PIXEL, { headers: { "content-type": "image/png" } });
      }
      return new Response(path === "/endless" ? ENDLESS : REVEAL, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
});
afterAll(() => server?.stop(true));
beforeEach(() => {
  imageRequests = 0;
});

describe.skipIf(!RUN)("URL capture scroll pass (Playwright)", () => {
  const viewport = { w: 400, h: 300 };
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

  test("a full-page capture holds what only scrolling reveals", async () => {
    const r = await captureUrlScreenshot({ url: url("/reveal"), viewport, dom: true });
    const dom = JSON.stringify(r.dom);
    expect(r.pageError).toBeNull();
    // Revealed on the way down, and still revealed back at the top.
    expect(dom).toContain("section revealed");
    expect(imageRequests).toBe(1);
    // The header is the one the top of the page shows, not the scrolled one.
    expect(dom).toContain("header at top");
    expect(r.scroll).toMatchObject({ truncated: false });
    expect(r.scroll?.steps).toBeGreaterThan(10);
  }, 30_000);

  test("`scroll: false` captures the page as it loaded", async () => {
    const r = await captureUrlScreenshot({
      url: url("/reveal"),
      viewport,
      dom: true,
      scroll: false,
    });
    expect(JSON.stringify(r.dom)).toContain("section hidden");
    expect(imageRequests).toBe(0);
    expect(r.scroll).toBeUndefined();
  }, 30_000);

  test("a viewport capture never scrolls", async () => {
    const r = await captureUrlScreenshot({ url: url("/reveal"), viewport, fullPage: false });
    expect(imageRequests).toBe(0);
    expect(r.scroll).toBeUndefined();
  }, 30_000);

  test("a page that never ends is cut off, and says so", async () => {
    const r = await captureUrlScreenshot({ url: url("/endless"), viewport });
    expect(r.scroll?.truncated).toBe(true);
    expect(r.scroll?.heightAfter).toBeGreaterThan(r.scroll?.heightBefore ?? 0);
  }, 30_000);
});
