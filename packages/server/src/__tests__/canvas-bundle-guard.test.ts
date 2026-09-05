import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import type { Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { makeCanvasBundle } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * Canvas bundles (#18) are per-library: a non-default-library (MUI) screen in a
 * shadcn-default folder gets ITS OWN library's bundle (`?lib=mui`), while a
 * screen whose adapter declares no `canvasBundleSpec` keeps SSR. A screen with
 * a live island also keeps SSR so its marker subtree survives. Guards
 * makeCanvasBundle's per-library scoping — the real Bun.build path is covered
 * by canvas-bundle.test.ts, so the positive case records build() calls instead
 * of re-bundling MUI (which is slow and fd-hungry under the full suite).
 */

class RecordingBundler extends CanvasBundler {
  calls: string[] = [];
  constructor() {
    super(
      "/tmp",
      () => undefined,
      () => undefined,
    );
  }
  override async build(libraryId: string, componentIds: readonly string[]) {
    this.calls.push(libraryId);
    return {
      code: "export function mountScreen() {}\n",
      errors: [],
      usable: true,
      diagnostics: componentIds.map((id) => ({ id, status: "exact" as const })),
    };
  }
}

const theme: Theme = {
  name: "t",
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
  schemaVersion: 3 as const,
  toolVersion: "0.1.0",
  libraries: {
    shadcn: {
      id: "shadcn-upstream" as const,
      version: "t",
      source: "binary",
      componentsPath: "binary",
    },
    mui: { id: "mui" as const, version: "6", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "shadcn",
  extensions: {
    LiveChart: {
      importPath: "@/components/live-chart",
      props: [],
      render: "live" as const,
    },
    StaticBanner: {
      importPath: "@/components/static-banner",
      props: [],
      render: "static" as const,
    },
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const muiScreen: Screen = { id: "panel", name: "Panel", library: "mui", tree: { $ref: "Card" } };
const shadcnScreen: Screen = {
  id: "dash",
  name: "Dash",
  library: "shadcn",
  tree: { $ref: "Card" },
};

let ctx: MutationContext;
let folder: DesignFolder;

beforeEach(async () => {
  const tmp = join(tmpdir(), `velloo-cbguard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(config), "utf8");
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(theme), "utf8");
  await writeFile(join(tmp, "screens/panel.json"), JSON.stringify(muiScreen), "utf8");
  await writeFile(join(tmp, "screens/dash.json"), JSON.stringify(shadcnScreen), "utf8");
  folder = await loadDesignFolder(tmp);
  const shadcn = createShadcnProvider();
  ctx = {
    folder,
    providers: { shadcn, mui: createMuiProvider() },
    defaultProvider: shadcn,
    broadcast: () => undefined,
  };
});

describe("makeCanvasBundle per-library scoping", () => {
  test("a non-default-library (MUI) screen gets its own library's bundle", async () => {
    const bundler = new RecordingBundler();
    const thunk = makeCanvasBundle(ctx, bundler);
    const mui = await thunk(muiScreen, theme, false);
    expect(mui).toBeDefined();
    expect(mui?.url).toContain("lib=mui");
    expect(mui?.themeOptions).toBeDefined();
    expect(bundler.calls).toEqual(["mui"]);
    // The default-library shadcn screen has no bundle — its adapter declares
    // no canvasBundleSpec, so the spec check returns BEFORE any build.
    expect(await thunk(shadcnScreen, theme, false)).toBeUndefined();
    expect(bundler.calls).toEqual(["mui"]);
  });

  test("a bundler that cannot build the library's spec keeps the capture on SSR", async () => {
    // No resolvable host (tmp folder has no node_modules) → build errors → SSR.
    const bundler = new CanvasBundler(
      folder.root,
      () => undefined,
      (libraryId) => (ctx.providers[libraryId] as FrameworkAdapter | undefined)?.canvasBundleSpec,
    );
    const thunk = makeCanvasBundle(ctx, bundler);
    expect(await thunk(muiScreen, theme, false)).toBeUndefined();
  });

  test("a live island keeps the whole screen on SSR instead of being swallowed by the canvas mount", async () => {
    const bundler = new RecordingBundler();
    const thunk = makeCanvasBundle(ctx, bundler);
    const mixed: Screen = {
      ...muiScreen,
      tree: { $ref: "Card", children: [{ $ref: "LiveChart" }] },
    };
    expect(await thunk(mixed, theme, false)).toBeUndefined();
    expect(bundler.calls).toEqual([]);
  });

  // A `render:"static"` extension has no library registry entry either, so the
  // bundle would mount a placeholder box over the Tier-1 placeholder SSR drew.
  test("a static extension keeps the screen on SSR too, not just a live island", async () => {
    const bundler = new RecordingBundler();
    const thunk = makeCanvasBundle(ctx, bundler);
    const mixed: Screen = {
      ...muiScreen,
      tree: { $ref: "Card", children: [{ $ref: "StaticBanner" }] },
    };
    expect(await thunk(mixed, theme, false)).toBeUndefined();
    expect(bundler.calls).toEqual([]);
  });
});

describe("CanvasBundler cache", () => {
  /** A spec whose build always rejects, to prove a rejection is never cached. */
  const exploding = () => ({
    components: () => Promise.reject(new Error("boom")),
    styleRuntime: { kind: "none" as const },
  });

  test("a failed build is not cached as a rejected promise", async () => {
    const bundler = new CanvasBundler(folder.root, () => undefined, exploding);
    // Every call must resolve to a structured failure — never re-throw a stored
    // rejection, which used to wedge the frame render for the daemon's life.
    for (let i = 0; i < 3; i++) {
      const result = await bundler.build("shadcn", ["Button"]);
      expect(result.usable).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("the per-ref-set cache stays bounded", async () => {
    const bundler = new CanvasBundler(
      folder.root,
      () => undefined,
      () => ({
        components: (ids: readonly string[]) => ids.map((id) => ({ id, sources: [] })),
        styleRuntime: { kind: "none" as const },
      }),
    );
    // Distinct ref sets are reachable from ?refs= and from component_status, so
    // an unbounded map would accrete a Bun.build output per design edit.
    for (let i = 0; i < 200; i++) await bundler.build("shadcn", [`Comp${i}`]);
    expect(bundler.size).toBeLessThanOrEqual(48);
  });
});
