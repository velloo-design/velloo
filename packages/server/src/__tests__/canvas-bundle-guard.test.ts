import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import type { Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { makeCanvasBundle } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * The canvas bundle (#18) is built from the DEFAULT provider's components, so a
 * non-default-library screen in a multi-library folder must NOT get the bundle
 * (it would mount the wrong components) — it keeps SSR. Guards makeCanvasBundle.
 */

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
  schemaVersion: 1 as const,
  toolVersion: "0.1.0",
  libraries: {
    shadcn: {
      id: "shadcn-react" as const,
      version: "t",
      source: "binary",
      componentsPath: "binary",
    },
    mui: { id: "mui" as const, version: "6", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "shadcn",
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

describe("makeCanvasBundle multi-library guard", () => {
  test("a non-default-library (MUI) screen in a shadcn-default folder gets no bundle", async () => {
    const bundler = new CanvasBundler(
      folder.root,
      () => undefined,
      () => undefined,
    );
    const thunk = makeCanvasBundle(ctx, bundler);
    // The MUI screen's provider isn't the default (shadcn) → guard returns
    // undefined BEFORE any build, so the capture keeps SSR.
    expect(await thunk(muiScreen, theme, false)).toBeUndefined();
    // The default-library shadcn screen also has no bundle (shadcn declares no
    // canvasBundleSpec), but via the spec check, not a wrong-bundle mount.
    expect(await thunk(shadcnScreen, theme, false)).toBeUndefined();
  });
});
