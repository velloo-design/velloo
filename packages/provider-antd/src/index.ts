import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogFromManifest,
  type FrameworkAdapter,
  type Manifest,
  STYLE_PROP,
} from "@velloo/provider";
import { resolveProviderSrcDir } from "@velloo/provider/src-dir";
import { ANTD_INTRO } from "./intro.ts";
import { ANTD_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";
import { makeRenderPass } from "./render-pass.ts";
import { antdThemeOptions } from "./theme.ts";

/**
 * Ant Design v5 provider — a first-class FrameworkAdapter. antd ships as a
 * velloo dependency (pre-bundled), so its components SSR in-process against
 * the shared monorepo React; the adapter's cssinjs `renderPass` extracts the
 * style sheet. antd has no `sx` — per-node styling is the inline `style`
 * object (no Tailwind JIT), with antd tokens reachable as CSS variables via
 * the theme's `cssVar` mode. Canvas-safe overlays
 * (Modal/Drawer/Popover/Tooltip/Dropdown), `"antd"` codegen, a ConfigProvider
 * `ThemeConfig` theme emit, `velloo init --library=antd`, and the catalog are
 * all wired.
 */

export { ANTD_VERSION } from "./version.ts";

import { ANTD_VERSION } from "./version.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the provider src (Tailwind entry + sources), from dev + the bundled CLI. */
const srcDir = resolveProviderSrcDir(here, "provider-antd", process.env.VELLOO_ANTD_SRC);

export function createProvider(): FrameworkAdapter {
  return {
    id: "antd",
    version: ANTD_VERSION,
    label: "Ant Design v5",
    componentsDir: srcDir,
    styleEntryPath: join(srcDir, "tailwind-entry.css"),
    registry,
    loadManifest: async (): Promise<Manifest> => ANTD_MANIFEST,
    // The catalog is the antd *library* surface — every curated antd
    // component, all installed (bundled). The reused velloo helpers (source
    // "velloo", e.g. Icon→lucide) are always-available built-ins, not library
    // components to install, so they're excluded.
    catalog: async () =>
      catalogFromManifest(
        ANTD_MANIFEST.filter((c) => c.source === "antd"),
        { importPath: "antd" },
      ),
    styleChannel: STYLE_PROP,
    styleChannels: ["style"],
    mcpIntro: () => [...ANTD_INTRO],
    renderPass: (theme, dark) => makeRenderPass(theme, dark ?? false),
    codegenModule: "antd",
    themeToNative: (theme, dark) => antdThemeOptions(theme, dark),
    themeModule: {
      importLines: ['import { theme as antdTheme } from "antd";'],
      factory: null,
      defaultPath: "antd-theme.ts",
    },
    // canvasBundleSpec is deliberately absent in v1: the server's bundle-entry
    // builder only implements the emotion style runtime, so antd folders render
    // via the in-process cssinjs SSR path. Extending it means a new
    // `CanvasStyleRuntime` union member (kind: "cssinjs") in
    // packages/provider/src/adapter.ts plus a branch in
    // packages/server/src/live/canvas-bundle.ts.
  };
}

/** The id used in `Library.id` to select this provider. */
export const ANTD_PROVIDER_ID = "antd" as const;

export { antdThemeConfig, antdThemeOptions } from "./theme.ts";
