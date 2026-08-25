import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import type { Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { type MutationContext, setStyle } from "../index.ts";

/**
 * `set_style` routes a style payload through the screen's *native* channel:
 * a className string on a Tailwind (shadcn) folder, an `sx`
 * object on a MUI folder. The tool rejects a payload whose shape doesn't fit.
 */

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "#fff",
    foreground: "#111",
    primary: { DEFAULT: "#4f46e5", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const config = {
  schemaVersion: 1 as const,
  toolVersion: "0.1.0",
  libraries: {
    shadcn: {
      id: "shadcn-react" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
    mui: { id: "mui" as const, version: "6", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "shadcn",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const shadcnScreen: Screen = {
  id: "dashboard",
  name: "Dashboard",
  library: "shadcn",
  tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
};

const muiScreen: Screen = {
  id: "panel",
  name: "Panel",
  library: "mui",
  tree: { $ref: "Card", props: { variant: "outlined" }, children: [] },
};

let folder: DesignFolder;
let ctx: MutationContext;

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const shadcnProvider = createShadcnProvider();
const muiProvider = createMuiProvider();

beforeEach(async () => {
  const tmp = join(
    tmpdir(),
    `velloo-setstyle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), config);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/dashboard.json"), shadcnScreen);
  await writeJson(join(tmp, "screens/panel.json"), muiScreen);
  folder = await loadDesignFolder(tmp);
  const events: WatchEvent[] = [];
  ctx = {
    folder,
    providers: { shadcn: shadcnProvider, mui: muiProvider },
    defaultProvider: shadcnProvider,
    broadcast: (e) => events.push(e),
  };
});

function rootProps(screenId: string): Record<string, unknown> | undefined {
  const s = ctx.folder.screens.get(screenId);
  return (s?.tree as { props?: Record<string, unknown> }).props;
}

describe("set_style — Tailwind (shadcn) channel", () => {
  test("a className string replaces the node's className", async () => {
    const r = await setStyle(ctx, { screenId: "dashboard", path: [], style: "flex gap-4 p-6" });
    expect(r.ok).toBe(true);
    expect(rootProps("dashboard")?.className).toBe("flex gap-4 p-6");
  });

  test("an object payload is rejected on a Tailwind folder", async () => {
    const r = await setStyle(ctx, { screenId: "dashboard", path: [], style: { display: "flex" } });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "BadRequest")
      expect(r.error.message).toContain("className string");
  });

  test("an empty string clears className", async () => {
    const r = await setStyle(ctx, { screenId: "dashboard", path: [], style: "" });
    expect(r.ok).toBe(true);
    expect(rootProps("dashboard")?.className).toBeUndefined();
  });
});

describe("set_style — sx (MUI) channel", () => {
  test("an object payload lands on the sx prop", async () => {
    const r = await setStyle(ctx, {
      screenId: "panel",
      path: [],
      style: { display: "flex", gap: 2, p: 3 },
    });
    expect(r.ok).toBe(true);
    expect(rootProps("panel")?.sx).toEqual({ display: "flex", gap: 2, p: 3 });
    // The framework-native channel must not write className on a MUI folder.
    expect(rootProps("panel")?.className).toBeUndefined();
  });

  test("a second call merges shallowly; inner null removes one key", async () => {
    await setStyle(ctx, { screenId: "panel", path: [], style: { display: "flex", gap: 2 } });
    const r = await setStyle(ctx, { screenId: "panel", path: [], style: { gap: null, p: 4 } });
    expect(r.ok).toBe(true);
    expect(rootProps("panel")?.sx).toEqual({ display: "flex", p: 4 });
  });

  test("a string payload is rejected on a MUI folder", async () => {
    const r = await setStyle(ctx, { screenId: "panel", path: [], style: "p-6" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "BadRequest") expect(r.error.message).toContain("object");
  });

  test("style: null clears the sx prop entirely", async () => {
    await setStyle(ctx, { screenId: "panel", path: [], style: { display: "flex" } });
    const r = await setStyle(ctx, { screenId: "panel", path: [], style: null });
    expect(r.ok).toBe(true);
    expect(rootProps("panel")?.sx).toBeUndefined();
  });
});
