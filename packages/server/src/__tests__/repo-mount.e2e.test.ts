import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir, rename, writeFile } from "node:fs/promises";
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
        $ref: "Steps",
        $repo: repo("Steps"),
        props: { active: 1 },
        children: [
          {
            $ref: "Steps.Step",
            $repo: repo("Steps", { member: "Step" }),
            props: { label: "Build" },
          },
          {
            $ref: "Steps.Step",
            $repo: repo("Steps", { member: "Step" }),
            props: { label: "Ship" },
          },
        ],
      },
      { $ref: "EnvBadge", $repo: repo("EnvBadge") },
      { $ref: "Overlay", $repo: repo("Overlay"), props: { title: "Confirm" } },
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
        steps: [...(root?.querySelectorAll("ol.fx-steps li") ?? [])].map((li) =>
          li.getAttribute("data-step-state"),
        ),
        envMode: root?.querySelector("[data-env-mode]")?.getAttribute("data-env-mode") ?? null,
        overlay: (() => {
          const el = document.querySelector("[data-fixture-overlay]");
          return {
            portaled: el?.parentElement === document.body,
            path: el?.getAttribute("data-node-path") ?? null,
            bodyInline: document.body.style.pointerEvents,
            bodyComputed: getComputedStyle(document.body).pointerEvents,
          };
        })(),
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

  /** A full-surface MCP client against this server. */
  const mcp = async (): Promise<Client> => {
    const client = new Client({ name: "repo-e2e", version: "0.0.0" });
    const url = new URL(server.mcpUrl ?? "");
    url.searchParams.set("surface", "full");
    // The SDK's own transport type disagrees with `Transport` under
    // exactOptionalPropertyTypes (see mcp-wiring.test.ts).
    await client.connect(
      new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
    );
    return client;
  };

  test("renders the app's components for real, nested, inside its preview entry", async () => {
    const state = await mount();
    expect(state.mounted).toBe(true);
    expect(state.statCard).toBe("Uptime99.9%");
    expect(state.statCardPath).toBe("0");
    expect(state.panelHeading).toBe("Services");
    expect(state.badge).toBe("Healthy");
    expect(state.button).toBe("violet");
    // A parent that clones its children reaches the real components.
    expect(state.steps).toEqual(["done", "todo"]);
    // A module reading `process.env` as it loads doesn't take the mount down.
    expect(state.envMode).toBe("unset");
    expect(state.accent).toBe("#6d28d9");
    // The broken component stands aside for its proxy; its neighbours stay exact.
    expect(state.proxy).toBe(true);
    expect(statusOf(state.diagnostics, "Broken")?.status).toBe("proxy");
    expect(statusOf(state.diagnostics, "StatCard")?.status).toBe("exact");
    expect(statusOf(state.diagnostics, "ThemedButton")?.status).toBe("exact");
  }, 60_000);

  test("an app modal keeps the screen selectable, and owns what it portals", async () => {
    const state = await mount();
    // The component rendered nothing where it sits, so its output is only
    // reachable at the body — and without an identity nothing there can be
    // selected, which is the whole screen once an overlay covers it.
    expect(state.overlay.portaled).toBe(true);
    expect(state.overlay.path).toBe("4");
    // The modal really did lock the page; the mount overrules it. An inline
    // style set by app code stays, so this asserts the override, not its absence.
    expect(state.overlay.bodyInline).toBe("none");
    expect(state.overlay.bodyComputed).toBe("auto");
  }, 60_000);

  test("a screenshot mounts the same components the canvas does", async () => {
    // A capture loads the document instead of navigating to it, so the page has
    // no origin of its own: the bundle URL resolves against nothing and app code
    // that touches storage throws. Both kill the mount silently, leaving every
    // screenshot, compare and publish preview showing the server render — which
    // is exactly what they were all doing before this was caught.
    const client = await mcp();
    try {
      const shot = await client.callTool({ name: "screenshot", arguments: { screenId: "home" } });
      const text = (shot.content as { type: string; text?: string }[]).find(
        (part) => part.type === "text",
      )?.text;
      const report = JSON.parse(text ?? "{}") as {
        components?: {
          mounted: boolean;
          fidelity: Record<string, number>;
          notExact: { name: string; status: string }[];
        };
      };
      expect(report.components?.mounted).toBe(true);
      // The app's own components, rendered for real in the capture.
      expect(report.components?.fidelity.exact).toBeGreaterThanOrEqual(3);
      expect(report.components?.notExact.map((entry) => entry.name)).toEqual(["Broken"]);
    } finally {
      await client.close();
    }
  }, 60_000);

  test("what a mounted frame found reaches the daemon, marked as observed", async () => {
    await mount();
    // The frame beacons its findings; the status route merges them over the
    // build check, which can only say the module compiled.
    const ids = ["StatCard", "Broken"].join(",");
    const report = await (await fetch(`${server.url}/api/repo/status?ids=${ids}`)).json();
    const byId = new Map(
      (report.diagnostics as { id: string; status: string; observed?: boolean }[]).map((entry) => [
        entry.id,
        entry,
      ]),
    );
    expect(byId.get("Broken")).toMatchObject({ status: "proxy", observed: true });
    expect(byId.get("StatCard")).toMatchObject({ status: "exact", observed: true });
  }, 60_000);

  test("preview_status and emit_code over MCP", async () => {
    const client = await mcp();
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
        {
          from: "./src/components",
          named: ["Badge", "EnvBadge", "Overlay", "Panel", "StatCard", "Steps"],
        },
        { from: "./src/components/broken", named: ["Broken"] },
        { from: "./src/components/theme", named: ["ThemedButton"] },
      ]);
      expect(ir.jsx).toContain('<Panel.Header title="Services" />');
    } finally {
      await client.close();
    }
  }, 60_000);

  test("set_preview_entry writes the wrapper and proves it by mounting", async () => {
    const client = await mcp();
    try {
      // A wrapper that names a provider it doesn't have: written, mounted, and
      // reported failing — the point of the tool is that it checks rather than
      // trusting what it was handed.
      const broken = await client.callTool({
        name: "set_preview_entry",
        arguments: {
          source:
            'export default function Preview() {\n  throw new Error("no provider here");\n}\n',
        },
      });
      const failed = JSON.parse((broken.content as { text: string }[])[0]?.text ?? "{}");
      expect(failed.state).toBe("failing");
      expect(JSON.stringify(failed.probe)).toContain("no provider here");

      // A wrapper with no default export is refused before anything is written.
      const refused = await client.callTool({
        name: "set_preview_entry",
        arguments: { source: "export const Preview = () => null;\n" },
      });
      expect(refused.isError).toBe(true);

      // The real one: the app's stylesheet and its ThemeProvider.
      const toApp = relative(folder.root, app.root);
      const good = await client.callTool({
        name: "set_preview_entry",
        arguments: {
          source: [
            `import ${JSON.stringify(join(toApp, "src/styles.css"))};`,
            `import { ThemeProvider } from ${JSON.stringify(join(toApp, "src/components/theme"))};`,
            "export default function Preview({ children }) {",
            '  return <ThemeProvider accent="violet">{children}</ThemeProvider>;',
            "}",
          ].join("\n"),
        },
      });
      const report = JSON.parse((good.content as { text: string }[])[0]?.text ?? "{}");
      expect(report.state).toBe("valid");
      expect(report.probe).toMatchObject({ mounted: true, status: "exact" });
      // Written where the folder looks for it, so the canvas picks it up too.
      expect(report.preview).toMatchObject({ kind: "file" });
      expect(await Bun.file(join(folder.root, report.preview.path)).text()).toContain(
        "ThemeProvider",
      );
    } finally {
      await client.close();
    }
  }, 90_000);

  test("editing the app's source reaches the catalog without a restart", async () => {
    // The daemon watches the app's component directories: a component added
    // while the canvas is open has to appear, or every new component needs a
    // restart to become designable.
    await writeFile(
      join(app.root, "src/components/late.tsx"),
      'export function LateArrival({ tone = "quiet" }: { tone?: string }) {\n' +
        "  return <b data-late={tone}>late</b>;\n}\n",
    );
    const barrel = join(app.root, "src/components/index.ts");
    await writeFile(
      barrel,
      `${await Bun.file(barrel).text()}export { LateArrival } from "./late";\n`,
    );
    const app_jsx = join(app.root, "src/App.jsx");
    await writeFile(
      app_jsx,
      (await Bun.file(app_jsx).text())
        .replace("<EnvBadge />", '<EnvBadge />\n      <LateArrival tone="loud" />')
        .replace(
          "import { Badge, EnvBadge,",
          'import { LateArrival } from "./components/late";\nimport { Badge, EnvBadge,',
        ),
    );

    const deadline = Date.now() + 15_000;
    let entry: { id: string; props: { name: string }[]; states: unknown[] } | undefined;
    while (Date.now() < deadline && !entry) {
      await Bun.sleep(400);
      const catalog = (await (await fetch(`${server.url}/api/repo/components`)).json()) as {
        entries: { id: string; props: { name: string }[]; states: unknown[] }[];
      };
      entry = catalog.entries.find((candidate) => candidate.id === "LateArrival");
    }
    if (!entry) throw new Error("the catalog never noticed the new component");
    // Not just the name: its declared props and the call site come with it.
    expect(entry.props.map((prop) => prop.name)).toContain("tone");
    expect(entry.states.length).toBeGreaterThan(0);
  }, 60_000);

  test("without the preview entry, the provider-dependent component falls back alone", async () => {
    // Whatever it is called by now — `set_preview_entry` writes `preview.tsx`
    // in a folder that has none, and reuses the existing file when there is one.
    for (const name of await readdir(folder.root)) {
      if (/^preview\.[jt]sx$/.test(name)) {
        await rename(join(folder.root, name), join(folder.root, `${name}.off`));
      }
    }
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
