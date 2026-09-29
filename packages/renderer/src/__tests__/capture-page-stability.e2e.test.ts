import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withContext } from "../browser-pool.ts";
import { capturePage } from "../capture-page.ts";

/**
 * A page that never stops animating — Tailwind's `animate-ping` status dot —
 * is still one page. The stability guard exists to catch content that changed
 * between the screenshot and the DOM extract, not a keyframe that moved.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const PAGE = `<!doctype html><html><head><style>
@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
.ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
.fade { transition: opacity 10s linear; }
</style></head><body>
<button>Health status <span class="ping" style="display:inline-block;width:12px;height:12px;border-radius:9999px;background:green"></span></button>
<p id="fade" class="fade">Empty</p>
<script>requestAnimationFrame(() => { document.getElementById("fade").style.opacity = "0.2"; });</script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "velloo-capture-stability-"));
  server = Bun.serve({
    port: 0,
    fetch: () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
});
afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!RUN)("capturePage stability (Playwright)", () => {
  test("an infinite CSS animation or a running transition does not make a capture unstable", async () => {
    const outcome = await withContext({ viewport: { width: 400, height: 300 } }, async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/`);
      const result = await capturePage(page, { capturesRoot: root });
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running").length,
      );
      return { result, running };
    });
    expect(outcome.result.manifest.stability).toEqual({ status: "stable", attempts: 1 });
    // The page is handed back as it was: the capture must not leave it frozen.
    expect(outcome.running).toBeGreaterThan(0);
  }, 30_000);
});
