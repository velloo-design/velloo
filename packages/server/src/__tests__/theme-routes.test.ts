import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../activity.ts";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import type { WatchEvent } from "../watcher.ts";

/**
 * The canvas typography panel drives typesets over HTTP, so the route has to
 * accept the same spec shape the MCP tool does — including the nulls that clear
 * a control back to inherited, and the rename/remove a preset list needs.
 */

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let events: (WatchEvent | ActivityEvent)[];
let app: ReturnType<typeof createApp>;

async function diskTheme(): Promise<Theme> {
  return JSON.parse(await readFile(join(tmp, "theme/default.json"), "utf8")) as Theme;
}

async function setTypeset(typesets: unknown[]): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/api/theme/set_typeset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typesets }),
    }),
  );
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-theme-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig));
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme));
  folder = await loadDesignFolder(tmp);
  events = [];
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
  const jit = new TailwindJit(provider, join(folder.root, "screens"));
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    () => undefined,
  );
  app = createApp(() => ctx, jit, bundler, canvasBundler);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("set_typeset persists the controls and broadcasts theme-changed", async () => {
  const res = await setTypeset([{ leading: 1.4, flow: "1em" }]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { theme: Theme };
  expect(body.theme.typography.typesets?.default).toEqual({ leading: 1.4, flow: "1em" });
  expect((await diskTheme()).typography.typesets?.default).toEqual({ leading: 1.4, flow: "1em" });
  expect(events.some((e) => e.type === "theme-changed")).toBe(true);
});

test("null clears a control, which is how the panel returns one to inherited", async () => {
  await setTypeset([{ name: "docs", size: 18, leading: 2 }]);
  const res = await setTypeset([{ name: "docs", size: null }]);
  expect(res.status).toBe(200);
  expect((await diskTheme()).typography.typesets?.docs).toEqual({ leading: 2 });
});

test("presets can be added, renamed and removed over the same route", async () => {
  // A new preset authors nothing — it inherits every control until one moves.
  expect((await setTypeset([{ name: "docs" }])).status).toBe(200);
  expect((await diskTheme()).typography.typesets?.docs).toEqual({});

  expect((await setTypeset([{ name: "docs", renameTo: "guide" }])).status).toBe(200);
  expect(Object.keys((await diskTheme()).typography.typesets ?? {})).toEqual(["guide"]);

  expect((await setTypeset([{ name: "guide", remove: true }])).status).toBe(200);
  expect(Object.keys((await diskTheme()).typography.typesets ?? {})).toEqual([]);
});

test("a rejected spec answers with the typed error envelope, not a 500", async () => {
  const res = await setTypeset([{ name: "bad name", size: 14 }]);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: { kind?: string; reason?: string } };
  expect(body.error?.kind).toBe("InvalidThemePath");
  expect(body.error?.reason).toContain("selector-safe");
});
