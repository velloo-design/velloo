import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { createProvider } from "@velloo/provider-shadcn-upstream";
import { renderScreen } from "@velloo/renderer";
import type { Screen, Theme } from "@velloo/schema";
import { chromium } from "playwright-core";
import { buildCanvasBundle } from "../live/canvas-bundle.ts";

const RUN = process.env.VELLOO_E2E === "1";
const HOST = resolve(import.meta.dir, "../../../provider-mui");
const FIXTURE = join(import.meta.dir, "fixtures/shadcn-host");

const theme: Theme = {
  name: "fixture",
  colors: {
    background: "#ffffff",
    foreground: "#111111",
    primary: { DEFAULT: "#9333ea", foreground: "#ffffff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const screen: Screen = {
  id: "repo-components",
  name: "Repo components",
  tree: {
    $ref: "Card",
    children: [
      {
        $ref: "CardHeader",
        children: [{ $ref: "CardTitle", props: { children: "Compound host card" } }],
      },
      {
        $ref: "CardContent",
        children: [
          {
            $ref: "Button",
            props: { variant: "launch", size: "compact", children: "Ship it" },
          },
          { $ref: "Badge", props: { children: "Safe fallback" } },
          { $ref: "Heading", props: { level: 2, children: "Mixed helper" } },
        ],
      },
    ],
  },
};

describe.skipIf(!RUN)("repo-backed shadcn canvas mount (Playwright)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(async () => {
    const provider = createProvider({
      hostAppRoot: HOST,
      cacheDir: join(FIXTURE, "src/components"),
    });
    const spec = provider.canvasBundleSpec;
    if (!spec) throw new Error("shadcn provider has no canvas bundle spec");
    const refs = ["Card", "CardHeader", "CardTitle", "CardContent", "Button", "Badge", "Heading"];
    const result = await buildCanvasBundle(HOST, spec, refs, [
      { from: "@/", to: "../server/src/__tests__/fixtures/shadcn-host/src/" },
    ]);
    if (!result.usable || result.errors.length > 0) {
      throw new Error(`bundle errors: ${JSON.stringify(result.errors)}`);
    }
    const { html } = await renderScreen(screen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: provider.registry,
      canvasBundle: { url: "/bundle.js", themeOptions: null },
    });
    server = startServer(html, result.code);
    base = `http://127.0.0.1:${server.port}/`;
  });

  afterAll(() => server?.stop(true));

  test("mounts exact local files, compound children, helpers, and a component fallback", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`${base}?canvas=1`, { waitUntil: "networkidle" });
      await page.waitForFunction("window.__velloo_canvas_ready === true", { timeout: 10_000 });
      const state = await page.evaluate(() => {
        const root = document.getElementById("velloo-canvas-root");
        const ssr = document.getElementById("velloo-ssr");
        const button = root?.querySelector('[data-host-button="true"]');
        return {
          ssrHidden: ssr ? getComputedStyle(ssr).display === "none" : false,
          hostCard: Boolean(root?.querySelector('[data-host-card="true"]')),
          hostCardContent: Boolean(root?.querySelector('[data-host-card-content="true"]')),
          hostButton: Boolean(button),
          launchVariant: button?.getAttribute("data-host-variant"),
          compactSize: button?.getAttribute("data-host-size"),
          buttonPath: button?.getAttribute("data-node-path"),
          fallbackBadge: root?.textContent?.includes("Safe fallback") ?? false,
          helperHeading: root?.textContent?.includes("Mixed helper") ?? false,
          unavailable: Boolean(root?.querySelector("[data-velloo-component-fallback]")),
          statusBadge: document.querySelector("[data-velloo-canvas-status]")?.textContent,
          fidelity: document.documentElement.dataset.vellooCanvasFidelity,
        };
      });
      expect(pageErrors).toEqual([]);
      expect(state).toEqual({
        ssrHidden: true,
        hostCard: true,
        hostCardContent: true,
        hostButton: true,
        launchVariant: "launch",
        compactSize: "compact",
        buttonPath: "1.0",
        fallbackBadge: true,
        helperHeading: true,
        unavailable: false,
        statusBadge: "Canvas: 2 fallback",
        fidelity: "fallback",
      });
      const shot = await page.screenshot();
      expect(shot.byteLength).toBeGreaterThan(1_000);
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
        port: 38_000 + Math.floor(Math.random() * 10_000),
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
