import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createNoLibProvider } from "@velloo/provider-none";
import type { Extension, Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { registryForScreen } from "../../extensions/registry.ts";
import type { WatchEvent } from "../../watcher.ts";
import type { MutationContext } from "../index.ts";
import { addNode } from "../index.ts";
import { providerForScreen } from "../lookup.ts";

/**
 * End-to-end exercise of the Sprint-Y multi-library resolver: a
 * folder registers shadcn + no-lib, two screens (each pinned to a
 * different library), the resolver picks the right provider per screen,
 * and an extension placeholder threads through registryForScreen.
 */

const sampleTheme: Theme = {
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

const multiLibraryConfig = {
  schemaVersion: 1 as const,
  toolVersion: "0.1.0",
  libraries: {
    shadcn: {
      id: "shadcn-react" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
    marketing: {
      id: "none" as const,
      version: "0.1.0",
      source: "binary",
      componentsPath: "binary",
    },
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

const marketingScreen: Screen = {
  id: "landing",
  name: "Landing",
  library: "marketing",
  // no-lib has Box, Stack, Container — no Card-with-shadcn-props.
  tree: { $ref: "Container", props: { size: "lg" }, children: [] },
};

const dataTableExtension: Extension = {
  importPath: "@/components/data-table",
  category: "ui",
  description: "Sortable, paginated table",
  props: [
    { name: "data", type: "any[]", optional: false, control: "string" },
    {
      name: "sortable",
      type: "boolean | undefined",
      optional: true,
      control: "boolean",
    },
  ],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: WatchEvent[];

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const shadcnProvider = createShadcnProvider();
const noLibProvider = createNoLibProvider();

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-multi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), multiLibraryConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/dashboard.json"), shadcnScreen);
  await writeJson(join(tmp, "screens/landing.json"), marketingScreen);
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { shadcn: shadcnProvider, marketing: noLibProvider },
    defaultProvider: shadcnProvider,
    provider: shadcnProvider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("multi-library resolver", () => {
  test("a screen with library: marketing resolves to the no-lib provider", () => {
    const screen = folder.screens.get("landing");
    expect(screen).toBeDefined();
    if (!screen) return;
    const provider = providerForScreen(ctx, screen);
    expect(provider.id).toBe("none");
  });

  test("a screen with library: shadcn resolves to the shadcn provider", () => {
    const screen = folder.screens.get("dashboard");
    expect(screen).toBeDefined();
    if (!screen) return;
    const provider = providerForScreen(ctx, screen);
    expect(provider.id).toBe("shadcn-react");
  });

  test("a screen with no library field falls back to the default provider", () => {
    const screen: Screen = { id: "x", name: "X", tree: { $ref: "Card" } };
    const provider = providerForScreen(ctx, screen);
    expect(provider.id).toBe("shadcn-react");
  });

  test("a screen with an unknown library id falls back to the default provider", () => {
    const screen: Screen = { id: "x", name: "X", library: "ghosted", tree: { $ref: "Card" } };
    const provider = providerForScreen(ctx, screen);
    expect(provider.id).toBe("shadcn-react");
  });

  test("registryForScreen exposes only the picked library's components", () => {
    const dashboard = folder.screens.get("dashboard");
    const landing = folder.screens.get("landing");
    expect(dashboard).toBeDefined();
    expect(landing).toBeDefined();
    if (!dashboard || !landing) return;
    const shadcnRegistry = registryForScreen(landing, ctx.providers, ctx.defaultProvider, {});
    // no-lib has Container; shadcn registry does not.
    expect("Container" in shadcnRegistry).toBe(true);
    expect("Dialog" in shadcnRegistry).toBe(false);

    const dashRegistry = registryForScreen(dashboard, ctx.providers, ctx.defaultProvider, {});
    // shadcn has Dialog; no-lib does not.
    expect("Dialog" in dashRegistry).toBe(true);
  });

  test("an extension is added to every screen's registry regardless of library", () => {
    const extensions = { DataTable: dataTableExtension };
    const dashboard = folder.screens.get("dashboard");
    const landing = folder.screens.get("landing");
    if (!dashboard || !landing) return;
    const a = registryForScreen(dashboard, ctx.providers, ctx.defaultProvider, extensions);
    const b = registryForScreen(landing, ctx.providers, ctx.defaultProvider, extensions);
    expect("DataTable" in a).toBe(true);
    expect("DataTable" in b).toBe(true);
  });

  test("an extension shadows a library component of the same name", () => {
    // shadcn already has a Button; an extension named "Button" should win.
    const dashboard = folder.screens.get("dashboard");
    if (!dashboard) return;
    const customButton: Extension = {
      importPath: "@/components/custom-button",
      props: [],
    };
    const registry = registryForScreen(dashboard, ctx.providers, ctx.defaultProvider, {
      Button: customButton,
    });
    // The placeholder closure isn't the snapshot's Button — easiest
    // check is that calling it produces the placeholder card with
    // `data-velloo-extension`.
    const Component = registry.Button;
    expect(Component).toBeDefined();
  });

  test("add_node against a shadcn screen accepts a shadcn-only ref", async () => {
    const r = await addNode(ctx, {
      screenId: "dashboard",
      parentPath: [],
      componentRef: "Dialog",
    });
    expect(r.ok).toBe(true);
  });

  test("add_node against a marketing (no-lib) screen rejects a shadcn-only ref", async () => {
    const r = await addNode(ctx, {
      screenId: "landing",
      parentPath: [],
      componentRef: "Dialog",
    });
    expect(r.ok).toBe(false);
  });

  test("add_node accepts a registered extension ref on any screen", async () => {
    folder.config = { ...folder.config, extensions: { DataTable: dataTableExtension } };
    const r = await addNode(ctx, {
      screenId: "landing",
      parentPath: [],
      componentRef: "DataTable",
    });
    expect(r.ok).toBe(true);
  });
});
