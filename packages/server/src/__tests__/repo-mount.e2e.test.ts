import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rename } from "node:fs/promises";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Screen } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";
import { createServer, type ServerHandle } from "../index.ts";
import { fixtureApp } from "../repo/__tests__/fixture-app.ts";
import { designConfig, scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * The app's own components, rendered for real by the daemon and a browser:
 * nested children and compound parts, a preview entry supplying context and
 * the app's stylesheet, a broken component standing aside for its proxy
 * without costing its neighbours, and — with the preview entry gone — a
 * missing provider reported by name. Opt-in like every browser suite:
 * `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const repo = (exportName: string, extra: Record<string, string> = {}) => ({
  importPath: "./src/components",
  exportName,
  ...extra,
});

const screen: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { style: { padding: "24px", display: "grid", gap: "12px" } },
    children: [
      {
        $ref: "StatCard",
        $repo: repo("StatCard"),
        props: { label: "Uptime", value: "99.9%", tone: "positive" },
      },
      {
        $ref: "Panel",
        $repo: repo("Panel"),
        children: [
          {
            $ref: "Panel.Header",
            $repo: repo("Panel", { member: "Header" }),
            props: { title: "Services" },
          },
          {
            $ref: "Badge",
            $repo: repo("Badge"),
            props: { variant: "outline", children: "Healthy" },
          },
        ],
      },
      {
        $ref: "ThemedButton",
        $repo: { importPath: "./src/components/theme", exportName: "ThemedButton" },
        props: { children: "Deploy" },
      },
      {
        $ref: "Broken",
        $repo: {
          importPath: "./src/components/broken",
          exportName: "Broken",
          proxy: "broken-proxy",
        },
      },
    ],
  },
};

describe.skipIf(!RUN)("repository components mounted in a real browser", () => {
  let app: Awaited<ReturnType<typeof fixtureApp>>;
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let browser: Browser;

  beforeAll(async () => {
    app = await fixtureApp();
    folder = await scaffoldDesignFolder({
      label: "repo-mount",
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: app.root },
      }),
      screens: { home: screen },
      snippets: {
        "broken-proxy": {
          id: "broken-proxy",
          name: "Broken proxy",
          params: [],
          tree: { $ref: "Box", props: { children: "Broken proxy" } },
        },
      },
    });
    // The preview entry lives in the design folder and reaches into the app.
    const toApp = relative(folder.root, app.root);
    await folder.write(
      "preview.jsx",
      [
        `import ${JSON.stringify(join(toApp, "src/styles.css"))};`,
        `import { ThemeProvider } from ${JSON.stringify(join(toApp, "src/components/theme"))};`,
        "export default function Preview({ children }) {",
        '  return <ThemeProvider accent="violet">{children}</ThemeProvider>;',
        "}",
      ].join("\n"),
    );
    server = await createServer({
      folder: folder.root,
      port: 0,
      mcp: { transport: "http", port: 0 },
    });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await folder?.cleanup();
    await app?.cleanup();
  });

  const mount = async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.url}/api/render/home?w=1024&h=768`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (window as Window & { __velloo_canvas_ready?: boolean }).__velloo_canvas_ready === true,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => {
      const root = document.getElementById("velloo-canvas-root");
      const ssr = document.getElementById("velloo-ssr");
      const w = window as Window & {
        __velloo_canvas_diagnostics?: { id: string; status: string; code?: string }[];
      };
      return {
        mounted: ssr ? getComputedStyle(ssr).display === "none" : false,
        statCard: root?.querySelector('[data-tone="positive"]')?.textContent ?? null,
        statCardPath:
          root?.querySelector('[data-tone="positive"]')?.getAttribute("data-node-path") ?? null,
        panelHeading: root?.querySelector("section.fx-card h3")?.textContent ?? null,
        badge: root?.querySelector('section.fx-card [data-variant="outline"]')?.textContent ?? null,
        button: root?.querySelector("button")?.getAttribute("data-accent") ?? null,
        proxy: root?.textContent?.includes("Broken proxy") ?? false,
        accent: getComputedStyle(document.documentElement)
          .getPropertyValue("--fixture-accent")
          .trim(),
        diagnostics: (w.__velloo_canvas_diagnostics ?? []).filter((d) => d.id.startsWith("repo:")),
      };
    });
    await page.close();
    return { ...state, errors };
  };

  const statusOf = (diagnostics: { id: string; status: string; code?: string }[], name: string) =>
    diagnostics.find((d) => d.id.includes(`#${name}`));

  test("renders the app's components for real, nested, inside its preview entry", async () => {
    const state = await mount();
    expect(state.mounted).toBe(true);
    expect(state.statCard).toBe("Uptime99.9%");
    expect(state.statCardPath).toBe("0");
    expect(state.panelHeading).toBe("Services");
    expect(state.badge).toBe("Healthy");
    expect(state.button).toBe("violet");
    expect(state.accent).toBe("#6d28d9");
    // The broken component stands aside for its proxy; its neighbours stay exact.
    expect(state.proxy).toBe(true);
    expect(statusOf(state.diagnostics, "Broken")?.status).toBe("proxy");
    expect(statusOf(state.diagnostics, "StatCard")?.status).toBe("exact");
    expect(statusOf(state.diagnostics, "ThemedButton")?.status).toBe("exact");
  }, 60_000);

  test("preview_status and emit_code over MCP", async () => {
    const client = new Client({ name: "repo-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    // The SDK's own transport type disagrees with `Transport` under
    // exactOptionalPropertyTypes (see mcp-wiring.test.ts).
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
    try {
      const status = await client.callTool({ name: "preview_status", arguments: {} });
      const report = JSON.parse((status.content as { text: string }[])[0]?.text ?? "{}");
      if (report.state !== "valid") console.error(JSON.stringify(report, null, 1));
      expect(report.state).toBe("valid");
      expect(report.preview).toMatchObject({ kind: "file", path: "preview.jsx" });
      expect(report.appWrappers).toEqual([
        expect.objectContaining({ name: "ThemeProvider", from: "./src/components/theme" }),
      ]);
      const emitted = await client.callTool({ name: "emit_code", arguments: { screenId: "home" } });
      const ir = emitted.structuredContent as { repoImports: unknown[]; jsx: string };
      expect(ir.repoImports).toEqual([
        { from: "./src/components", named: ["Badge", "Panel", "StatCard"] },
        { from: "./src/components/broken", named: ["Broken"] },
        { from: "./src/components/theme", named: ["ThemedButton"] },
      ]);
      expect(ir.jsx).toContain('<Panel.Header title="Services" />');
    } finally {
      await client.close();
    }
  }, 60_000);

  test("without the preview entry, the provider-dependent component falls back alone", async () => {
    await rename(join(folder.root, "preview.jsx"), join(folder.root, "preview.jsx.off"));
    // The design-folder watcher reloads on its own; give it a poll to notice.
    await Bun.sleep(1200);
    const state = await mount();
    expect(state.mounted).toBe(true);
    expect(state.button).toBeNull();
    expect(statusOf(state.diagnostics, "ThemedButton")).toMatchObject({
      status: "unavailable",
      code: "missing-provider",
    });
    expect(statusOf(state.diagnostics, "StatCard")?.status).toBe("exact");
    expect(state.statCard).toBe("Uptime99.9%");
  }, 60_000);
});
