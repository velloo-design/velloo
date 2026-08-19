import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromiumExecutable, renderScreen } from "@velloo/renderer";
import type { Extension, Screen, Theme } from "@velloo/schema";
import { buildExtensionRegistry } from "../../extensions/registry.ts";
import { LiveBundler, liveExtensions } from "../component-bundler.ts";

/**
 * End-to-end guard for the live-island (`render:"live"`) path — the one
 * `compare_to_url` / `screenshot` / `render_snippet` rely on to show a host
 * app's real chart instead of a static placeholder. Builds a real bundle from
 * a host component (no fs mocks), serves it with the CORS header the live
 * route sets, renders a screen with `liveBundleUrl`, and confirms the
 * component actually CLIENT-MOUNTS in headless Chromium (the placeholder
 * skeleton hides, `__velloo_live_ready` flips). The host component emits a
 * recharts-shaped SVG so the asserted DOM mirrors a real chart mount without
 * depending on recharts being installed in this monorepo.
 *
 * The browser leg is skipped when Chromium isn't installed (the on-demand
 * extra) so `bun test` stays green on a bare checkout.
 */

const repoRoot = resolve(import.meta.dir, "../../../../..");
const rendererDir = join(repoRoot, "packages/renderer");
const reactPkg = dirname(Bun.resolveSync("react", rendererDir));
const reactDomPkg = dirname(Bun.resolveSync("react-dom/client", rendererDir));
const hasChromium = (await chromiumExecutable()) !== null;

// Minimal Playwright surface — typed locally so the server package needn't
// depend on playwright-core (it's the renderer's on-demand devDep, resolved
// at runtime from there).
interface PwPage {
  on(event: "pageerror", cb: (e: Error) => void): void;
  setContent(html: string, opts: { waitUntil: "domcontentloaded" }): Promise<void>;
  waitForFunction(fn: () => boolean, arg: undefined, opts: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: { viewport: { width: number; height: number } }): Promise<PwContext>;
  close(): Promise<void>;
}

const theme = {
  name: "default",
  colors: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
    secondary: { DEFAULT: "#f1f5f9", foreground: "#0a0a0a" },
    muted: { DEFAULT: "#f1f5f9", foreground: "#64748b" },
    accent: { DEFAULT: "#f1f5f9", foreground: "#0a0a0a" },
    destructive: { DEFAULT: "#ef4444", foreground: "#ffffff" },
    border: "#e2e8f0",
    input: "#e2e8f0",
    ring: "#94a3b8",
    card: { DEFAULT: "#ffffff", foreground: "#0a0a0a" },
    popover: { DEFAULT: "#ffffff", foreground: "#0a0a0a" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: {},
  radius: { md: "0.5rem" },
} as unknown as Theme;

const extensions: Record<string, Extension> = {
  RevenueChart: { importPath: "@/charts/RevenueChart", props: [], render: "live" },
};
const viewport = { w: 640, h: 400 };
const screen: Screen = { id: "chart", name: "Chart", tree: { $ref: "RevenueChart", props: {} } };

let tmp: string;
let bundler: LiveBundler;

beforeAll(async () => {
  tmp = join(
    tmpdir(),
    `velloo-live-e2e-${Bun.hash(`${import.meta.dir}${Math.random()}`).toString(16)}`,
  );
  const hostRoot = join(tmp, "app");
  await mkdir(join(hostRoot, "node_modules"), { recursive: true });
  await mkdir(join(hostRoot, "src", "charts"), { recursive: true });
  // Symlink the repo's react/react-dom so the bundler resolves them the way a
  // flat host app would (the live bundle links against the host's React copy).
  await symlink(reactPkg, join(hostRoot, "node_modules", "react"), "dir");
  await symlink(reactDomPkg, join(hostRoot, "node_modules", "react-dom"), "dir");
  await writeFile(
    join(hostRoot, "src", "charts", "RevenueChart.tsx"),
    `import * as React from "react";
export function RevenueChart() {
  return React.createElement(
    "svg",
    { className: "recharts-surface", width: 400, height: 200, "data-testid": "live-chart" },
    React.createElement("path", {
      d: "M0 200 L100 120 L200 160 L300 80 L400 100",
      fill: "none",
      stroke: "#4f46e5",
      strokeWidth: 2,
    }),
  );
}
`,
    "utf8",
  );
  bundler = new LiveBundler(
    join(tmp, "velloo"),
    () => ({ root: hostRoot, aliases: { "@/*": "src/*" } }),
    () => liveExtensions(extensions),
  );
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("live-island render path", () => {
  test("bundles the host chart and wires the live runtime into the render", async () => {
    const bundle = await bundler.build();
    expect(bundle.errors).toEqual([]);
    // The component's source lands in the registry-keyed bundle.
    expect(bundle.code).toContain('"RevenueChart"');
    expect(bundle.code).toContain("recharts-surface");

    const registry = buildExtensionRegistry(extensions);
    const { html } = await renderScreen(screen, theme, {
      viewport,
      snapshotCss: "",
      registry,
      liveBundleUrl: `/api/live/bundle.js?v=${bundler.version}`,
    });
    expect(html).toContain('data-live-node="true"');
    expect(html).toContain('data-live-ref="RevenueChart"');
    expect(html).toContain("window.__velloo_live");
    expect(html).toContain(`/api/live/bundle.js?v=${bundler.version}`);
    // The placeholder token must be interpolated, never left raw.
    expect(html).not.toContain("__VELLOO_LIVE_BUNDLE_URL__");
  });

  test.skipIf(!hasChromium)(
    "client-mounts the real component in headless Chromium (skeleton hides, ready flips)",
    async () => {
      const bundle = await bundler.build();
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(bundle.code, {
            headers: {
              "Content-Type": "text/javascript; charset=utf-8",
              // Playwright's setContent runs on an opaque origin; the dynamic
              // import of the bundle is CORS-gated without this.
              "Access-Control-Allow-Origin": "*",
            },
          });
        },
      });
      const pwPath = Bun.resolveSync("playwright-core", rendererDir);
      const { chromium } = (await import(pwPath)) as {
        chromium: { launch: () => Promise<PwBrowser> };
      };
      const browser = await chromium.launch();
      try {
        const registry = buildExtensionRegistry(extensions);
        const { html } = await renderScreen(screen, theme, {
          viewport,
          snapshotCss: "",
          registry,
          liveBundleUrl: `http://127.0.0.1:${server.port}/api/live/bundle.js?v=${bundler.version}`,
        });
        const context = await browser.newContext({
          viewport: { width: viewport.w, height: viewport.h },
        });
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(String(e)));
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(
            () =>
              (window as unknown as { __velloo_live_ready?: boolean }).__velloo_live_ready === true,
            undefined,
            { timeout: 15000 },
          )
          .catch(() => {});
        const info = await page.evaluate(() => {
          const skeleton = document.querySelector("[data-live-node] [data-velloo-extension]");
          return {
            ready:
              (window as unknown as { __velloo_live_ready?: boolean }).__velloo_live_ready === true,
            liveMounts: document.querySelectorAll("[data-live-mount]").length,
            svgInMount: document.querySelectorAll("[data-live-mount] svg.recharts-surface").length,
            pathInMount: document.querySelectorAll("[data-live-mount] path").length,
            skeletonHidden: skeleton ? getComputedStyle(skeleton).visibility === "hidden" : null,
          };
        });

        expect(pageErrors).toEqual([]);
        expect(info.ready).toBe(true);
        expect(info.liveMounts).toBe(1);
        expect(info.svgInMount).toBe(1);
        expect(info.pathInMount).toBeGreaterThan(0);
        expect(info.skeletonHidden).toBe(true);
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    30000,
  );
});
