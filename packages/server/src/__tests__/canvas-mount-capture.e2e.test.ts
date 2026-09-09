import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createProvider } from "@velloo/provider-mui";
import { captureScreenshot, renderScreen, screenshotBuffer } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { buildCanvasBundle } from "../live/canvas-bundle.ts";

/**
 * Captures go through the mount, and only the mounted tree carries identity.
 *
 * The capture path waits for `__velloo_canvas_ready`, so by screenshot time the
 * SSR fallback is hidden — and while it still wore the same `data-node-path`s,
 * Playwright's own selectors resolved to it: `screenshot { path }` clipped a
 * `display:none` element and sat there until the 20s capture budget ran out,
 * and the rect sweep reported a 0x0 box for every node. Neither is reachable
 * from the iframe runtime, so the fix has to be in the document.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";
const HOST = resolve(import.meta.dir, "../../../provider-mui");

const theme: Theme = {
  name: "t",
  colors: {
    background: "#ffffff",
    foreground: "#111827",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "#ffffff" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 12 },
};

const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Card",
    props: { variant: "outlined", sx: { p: 3 } },
    children: [
      { $ref: "Typography", props: { variant: "h5", children: "Installed MUI" } },
      { $ref: "Button", props: { variant: "contained", color: "primary", children: "Mounted" } },
    ],
  },
};

describe.skipIf(!RUN)("capture under a live canvas mount (Playwright)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let html: string;

  beforeAll(async () => {
    const mui = createProvider();
    const spec = mui.canvasBundleSpec;
    if (!spec) throw new Error("MUI adapter has no canvasBundleSpec");
    const { code, errors } = await buildCanvasBundle(HOST, spec, ["Card", "Typography", "Button"]);
    if (errors.length) throw new Error(`bundle errors: ${JSON.stringify(errors)}`);
    // The real bundle route sends this; without it the module import fails
    // CORS under `setContent` (origin "null") and the mount never commits —
    // which is exactly the state that hides the bug.
    server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/bundle.js") return new Response("nf", { status: 404 });
        return new Response(code, {
          headers: {
            "content-type": "text/javascript",
            "access-control-allow-origin": "*",
          },
        });
      },
    });
    const origin = `http://127.0.0.1:${server.port}/`;
    html = (
      await renderScreen(screen, theme, {
        viewport: { w: 800, h: 600 },
        snapshotCss: "",
        registry: mui.registry,
        renderPass: mui.renderPass?.(theme),
        baseHref: origin,
        canvasBundle: {
          url: `${origin}bundle.js`,
          themeOptions: mui.themeToNative?.(theme, false),
        },
      })
    ).html;
  });

  afterAll(() => server?.stop(true));

  test("clipping to a node path captures the mounted element, promptly", async () => {
    const started = Date.now();
    const png = await screenshotBuffer({
      html,
      viewport: { w: 800, h: 600 },
      clipSelector: '[data-node-path="1"]',
    });
    // PNG dimensions live in the IHDR chunk.
    expect(png.readUInt32BE(16)).toBeGreaterThan(1);
    expect(png.readUInt32BE(20)).toBeGreaterThan(1);
    // The hidden-copy bug did not return a wrong image, it burned the whole
    // 20s capture budget and threw — so elapsed time is the assertion.
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

  test("the rect sweep reports the mounted boxes, not 0x0 ghosts", async () => {
    const { nodeRects } = await captureScreenshot({ html, viewport: { w: 800, h: 600 } });
    expect(nodeRects.length).toBeGreaterThan(0);
    // Every reported path is unique: the hidden copy no longer answers.
    const paths = nodeRects.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const rect of nodeRects) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  }, 60_000);
});
