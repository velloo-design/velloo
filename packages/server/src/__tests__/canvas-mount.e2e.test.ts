import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createProvider } from "@velloo/provider-mui";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { chromium } from "playwright-core";
import { buildCanvasBundle } from "../live/canvas-bundle.ts";

/**
 * End-to-end proof of the #18 canvas mount: build the installed-MUI bundle, load
 * a screen doc in headless chromium, and confirm the client mount renders REAL
 * MUI over the SSR (the SSR fallback is hidden once the mount commits). Opt-in
 * (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 *
 * provider-mui's own dir is the "host app" — it has @mui/material + emotion +
 * react installed, exactly like a user's MUI project.
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

describe.skipIf(!RUN)("canvas mount (Playwright)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(async () => {
    const mui = createProvider();
    const spec = mui.canvasBundleSpec;
    if (!spec) throw new Error("MUI adapter has no canvasBundleSpec");
    const { code, errors } = await buildCanvasBundle(HOST, spec, ["Card", "Typography", "Button"]);
    if (errors.length) throw new Error(`bundle errors: ${JSON.stringify(errors)}`);
    const { html } = await renderScreen(screen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: mui.registry,
      renderPass: mui.renderPass?.(theme),
      canvasBundle: { url: "/bundle.js", themeOptions: mui.themeToNative?.(theme, false) },
    });
    server = startServer(html, code);
    base = `http://127.0.0.1:${server.port}/`;
  });

  afterAll(() => server?.stop(true));

  test("mounts the installed MUI components over the SSR", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errs: string[] = [];
      page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForFunction("window.__velloo_canvas_ready === true", { timeout: 10_000 });
      const r = await page.evaluate(() => {
        const root = document.getElementById("velloo-canvas-root");
        const ssr = document.getElementById("velloo-ssr");
        return {
          ssrHidden: ssr ? getComputedStyle(ssr).display === "none" : false,
          mountedButton: !!root?.querySelector(".MuiButton-contained"),
          mountedText: !!root?.textContent?.includes("Mounted"),
        };
      });
      expect(errs).toEqual([]);
      expect(r.mountedButton).toBe(true);
      expect(r.mountedText).toBe(true);
      expect(r.ssrHidden).toBe(true);
    } finally {
      await browser.close();
    }
  }, 30_000);
});

function startServer(html: string, bundle: string): ReturnType<typeof Bun.serve> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return Bun.serve({
        port: 28_000 + Math.floor(Math.random() * 10_000),
        hostname: "127.0.0.1",
        fetch(request) {
          return new URL(request.url).pathname === "/bundle.js"
            ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } })
            : new Response(html, { headers: { "Content-Type": "text/html" } });
        },
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
