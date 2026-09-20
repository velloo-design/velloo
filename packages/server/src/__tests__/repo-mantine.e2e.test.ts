import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Screen } from "@velloo/schema";
import { type Browser, chromium } from "playwright-core";
import { createServer, type ServerHandle } from "../index.ts";
import { designConfig, scaffoldDesignFolder } from "../testing/design-folder.ts";

/**
 * Mantine — a framework with no Velloo adapter — through the repository path:
 * real `@mantine/core` components from the app's install, wrapped by the
 * built-in recipe (MantineProvider + its stylesheet, themed from Velloo's
 * tokens), overlays adapted to stay in the frame, and an app-written preview
 * entry that forgets `styles.css` caught as `unstyled` rather than reported
 * exact. Needs the model-eval Mantine fixture with its dependencies installed:
 * `VELLOO_E2E=1 VELLOO_MANTINE_FIXTURE=<path> bun test`.
 */
const FIXTURE =
  process.env.VELLOO_MANTINE_FIXTURE ??
  join(homedir(), "play/velloo-modeleval/fixtures/mantine-sample");
const RUN =
  process.env.VELLOO_E2E === "1" &&
  existsSync(join(FIXTURE, "node_modules/@mantine/core/package.json"));

const core = (exportName: string, member?: string) => ({
  importPath: "@mantine/core",
  exportName,
  ...(member ? { member } : {}),
});

const screen: Screen = {
  id: "ops",
  name: "Ops",
  tree: {
    $ref: "Stack",
    $repo: core("Stack"),
    props: { p: "lg", gap: "md" },
    children: [
      {
        $ref: "Tabs",
        $repo: core("Tabs"),
        props: { defaultValue: "overview" },
        children: [
          {
            $ref: "Tabs.List",
            $repo: core("Tabs", "List"),
            children: [
              {
                $ref: "Tabs.Tab",
                $repo: core("Tabs", "Tab"),
                props: { value: "overview", children: "Overview" },
              },
              {
                $ref: "Tabs.Tab",
                $repo: core("Tabs", "Tab"),
                props: { value: "logs", children: "Logs" },
              },
            ],
          },
        ],
      },
      { $ref: "Badge", $repo: core("Badge"), props: { variant: "light", children: "Healthy" } },
      { $ref: "Button", $repo: core("Button"), props: { children: "Deploy" } },
      {
        $ref: "Menu",
        $repo: core("Menu"),
        props: { opened: true },
        children: [
          {
            $ref: "Menu.Target",
            $repo: core("Menu", "Target"),
            children: [
              {
                $ref: "Button",
                $repo: core("Button"),
                props: { variant: "default", children: "Actions" },
              },
            ],
          },
          {
            $ref: "Menu.Dropdown",
            $repo: core("Menu", "Dropdown"),
            children: [
              { $ref: "Menu.Item", $repo: core("Menu", "Item"), props: { children: "Restart" } },
            ],
          },
        ],
      },
      {
        $ref: "RingProgress",
        $repo: core("RingProgress"),
        props: { size: 90, sections: [{ value: 72, color: "velloo" }] },
      },
    ],
  },
};

describe.skipIf(!RUN)("Mantine through the repository path (Playwright)", () => {
  let folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  let server: ServerHandle;
  let browser: Browser;

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({
      label: "repo-mantine",
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: FIXTURE },
      }),
      theme: {
        colors: {
          background: "#ffffff",
          foreground: "#111827",
          primary: { DEFAULT: "#0f766e", foreground: "#ffffff" },
        },
      },
      screens: { ops: screen },
    });
    server = await createServer({ folder: folder.root, port: 0 });
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await folder?.cleanup();
  });

  const mount = async () => {
    const page = await browser.newPage();
    await page.goto(`${server.url}/api/render/ops?w=1200&h=900`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (window as Window & { __velloo_canvas_ready?: boolean }).__velloo_canvas_ready === true,
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const root = document.getElementById("velloo-canvas-root");
      const ssr = document.getElementById("velloo-ssr");
      const w = window as Window & {
        __velloo_canvas_diagnostics?: { id: string; status: string; code?: string }[];
      };
      const tab = root?.querySelector('[role="tab"]');
      const menuItem = [...(root?.querySelectorAll('[role="menuitem"]') ?? [])].map(
        (el) => el.textContent,
      );
      return {
        mounted: ssr ? getComputedStyle(ssr).display === "none" : false,
        tabs: [...(root?.querySelectorAll('[role="tab"]') ?? [])].map((el) => el.textContent),
        tabPath: tab?.closest("[data-node-path]")?.getAttribute("data-node-path") ?? null,
        menuInFrame: menuItem,
        primary: getComputedStyle(document.documentElement)
          .getPropertyValue("--mantine-primary-color-filled")
          .trim(),
        buttonRadius: root
          ? getComputedStyle(root.querySelector("button") as Element).borderTopLeftRadius
          : "",
        diagnostics: (w.__velloo_canvas_diagnostics ?? []).filter((d) => d.id.startsWith("repo:")),
      };
    });
    await page.close();
    return state;
  };

  const of = (d: { id: string; status: string; code?: string }[], name: string) =>
    d.find((entry) => entry.id.endsWith(`#${name}`));

  test("renders real Mantine inside the recipe's provider, themed from Velloo's tokens", async () => {
    const state = await mount();
    expect(state.mounted).toBe(true);
    expect(state.tabs).toEqual(["Overview", "Logs"]);
    expect(state.tabPath).not.toBeNull();
    // An opened Menu renders inside the frame, not in a body portal.
    expect(state.menuInFrame).toEqual(["Restart"]);
    // The recipe maps the Velloo primary token to Mantine's primary shade.
    expect(state.primary).toBe("#0f766e");
    expect(of(state.diagnostics, "Tabs")?.status).toBe("exact");
    expect(of(state.diagnostics, "Menu")?.status).toBe("adapted");
    expect(state.diagnostics.filter((d) => d.code === "unstyled")).toEqual([]);
  }, 90_000);

  test("a preview entry that forgets Mantine's stylesheet is reported unstyled, not exact", async () => {
    await folder.write(
      "preview.jsx",
      [
        'import { MantineProvider } from "@mantine/core";',
        "export default function Preview({ children }) {",
        "  return <MantineProvider>{children}</MantineProvider>;",
        "}",
      ].join("\n"),
    );
    await Bun.sleep(1200);
    const state = await mount();
    expect(state.mounted).toBe(true);
    expect(of(state.diagnostics, "Tabs")).toMatchObject({ status: "unstyled", code: "unstyled" });
    await rm(join(folder.root, "preview.jsx"));
  }, 90_000);
});
