import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogFromManifest,
  type FrameworkAdapter,
  type Manifest,
  SX_PROP,
} from "@velloo/provider";
import { resolveProviderSrcDir } from "@velloo/provider/src-dir";
import { CHAKRA_INTRO } from "./intro.ts";
import { CHAKRA_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";
import { makeRenderPass } from "./render-pass.ts";
import { chakraThemeOptions } from "./theme.ts";

/**
 * Chakra UI v2 provider — a first-class FrameworkAdapter. Chakra ships as a
 * velloo dependency (pre-bundled), so its components SSR in-process against
 * the shared monorepo React; the adapter's emotion `renderPass` extracts the
 * critical CSS (chakra rides the same emotion machinery as MUI). Styling is
 * the native `sx` prop, and the theme projects velloo tokens onto an
 * `extendTheme` POJO (brand scale, semantic body colors, radii, fonts).
 * Canvas-safe overlays (Modal/Drawer/Popover/Menu/Tooltip compositions),
 * `"@chakra-ui/react"` codegen, an `extendTheme` theme emit,
 * `velloo init --library=chakra`, and the catalog are all wired.
 */

export const CHAKRA_VERSION = "2" as const;
const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the provider src (Tailwind entry + sources), from dev + the bundled CLI. */
const srcDir = resolveProviderSrcDir(here, "provider-chakra", process.env.VELLOO_CHAKRA_SRC);

export function createProvider(): FrameworkAdapter {
  return {
    id: "chakra",
    version: CHAKRA_VERSION,
    label: "Chakra UI v2",
    componentsDir: srcDir,
    styleEntryPath: join(srcDir, "tailwind-entry.css"),
    registry,
    loadManifest: async (): Promise<Manifest> => CHAKRA_MANIFEST,
    // The catalog is the chakra *library* surface — every curated chakra
    // component, all installed (bundled). The reused velloo helpers (source
    // "velloo", e.g. Icon→lucide) are always-available built-ins, not library
    // components to install, so they're excluded.
    catalog: async () =>
      catalogFromManifest(
        CHAKRA_MANIFEST.filter((c) => c.source === "chakra"),
        { importPath: "@chakra-ui/react" },
      ),
    styleChannel: SX_PROP,
    styleChannels: ["sx"],
    mcpIntro: () => [...CHAKRA_INTRO],
    renderPass: (theme, dark) => makeRenderPass(theme, dark ?? false),
    codegenModule: "@chakra-ui/react",
    themeToNative: (theme, dark) => chakraThemeOptions(theme, dark),
    themeModule: {
      importLines: ['import { extendTheme } from "@chakra-ui/react";'],
      factory: "extendTheme",
      defaultPath: "chakra-theme.ts",
    },
    // canvasBundleSpec is deliberately absent in v1: the server's bundle-entry
    // builder implements only the MUI-shaped emotion style runtime (its entry
    // template expects `ThemeProvider` + `createTheme` from `stylesModule`);
    // chakra needs `ChakraProvider` + `extendTheme`, so chakra folders render
    // via the in-process emotion SSR path. Extending it means teaching the
    // emotion `CanvasStyleRuntime` a provider/factory shape (or a new union
    // member) in packages/provider/src/adapter.ts plus a branch in
    // packages/server/src/live/canvas-bundle.ts.
  };
}

/** The id used in `Library.id` to select this provider. */
export const CHAKRA_PROVIDER_ID = "chakra" as const;

export { brandScale, chakraThemeOptions } from "./theme.ts";
