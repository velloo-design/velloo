import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { captureUrlScreenshot } from "../url-capture.ts";

/**
 * A page that fetches its data after first paint. Network idle is not
 * "loaded" for it: the capture has to wait out the loading state, and if the
 * data never arrives, say so rather than hand back a picture of a spinner for
 * the diff to score.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

/** Swaps "Loading…" for the data after `delay` ms — a timer, so the network is idle throughout. */
const page = (delay: number | null) => `<!doctype html><html><body>
<main><p id="state">Loading…</p></main>
<script>${delay === null ? "" : `setTimeout(() => { document.getElementById("state").textContent = "12 contacts"; }, ${delay});`}</script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const body = path === "/never" ? page(null) : page(1500);
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
});
afterAll(() => server?.stop(true));

describe.skipIf(!RUN)("URL capture settle (Playwright)", () => {
  const viewport = { w: 400, h: 300 };

  test("waits for a late loading state to clear", async () => {
    const r = await captureUrlScreenshot({
      url: `http://127.0.0.1:${server.port}/late`,
      viewport,
      fullPage: false,
      dom: true,
    });
    expect(r.pageError).toBeNull();
    expect(JSON.stringify(r.dom)).toContain("12 contacts");
  }, 30_000);

  test("flags a page that is still loading when the budget runs out", async () => {
    const r = await captureUrlScreenshot({
      url: `http://127.0.0.1:${server.port}/never`,
      viewport,
      fullPage: false,
      settleTimeoutMs: 1500,
    });
    expect(r.pageError).toContain("still showing a loading state");
  }, 30_000);
});
