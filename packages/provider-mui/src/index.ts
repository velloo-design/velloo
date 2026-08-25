import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogFromManifest,
  type FrameworkAdapter,
  type Manifest,
  resolveProviderSrcDir,
  SX_PROP,
} from "@velloo/provider";
import { MUI_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";
import { makeRenderPass } from "./render-pass.ts";
import { muiThemeOptions } from "./theme.ts";

/**
 * Material UI v6 provider — a first-class FrameworkAdapter. MUI ships as a
 * velloo dependency (pre-bundle), so its components SSR in-process against the shared monorepo
 * React; the adapter's emotion `renderPass` extracts the critical CSS. Styling
 * is the `sx` prop (not Tailwind), and the theme projects velloo tokens onto a
 * MUI `createTheme`. Canvas-safe overlays (Dialog/Menu/Popover/Drawer/Snackbar),
 * `sx`/`createTheme` codegen, `velloo init --library=mui`, the catalog, and the
 * installed-component canvas bundle (`canvasBundleSpec`) are all wired. The only
 * deliberate non-build is a `.d.ts` manifest generator — the curated
 * `MUI_MANIFEST` reads better than a generated dump of MUI's type surface.
 */

export const MUI_VERSION = "6" as const;
const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the provider src (Tailwind entry + sources), from dev + the bundled CLI. */
const srcDir = resolveProviderSrcDir(here, "provider-mui", process.env.VELLOO_MUI_SRC);

export function createProvider(): FrameworkAdapter {
  return {
    id: "mui",
    version: MUI_VERSION,
    label: "Material UI v6",
    componentsDir: srcDir,
    styleEntryPath: join(srcDir, "tailwind-entry.css"),
    registry,
    loadManifest: async (): Promise<Manifest> => MUI_MANIFEST,
    // The catalog is the MUI *library* surface — every `@mui/material` component,
    // all installed (bundled). The reused velloo helpers (source "velloo", e.g.
    // Icon→lucide) are always-available built-ins, not library components to
    // install, so they're excluded.
    catalog: async () =>
      catalogFromManifest(
        MUI_MANIFEST.filter((c) => c.source === "mui"),
        { importPath: "@mui/material" },
      ),
    styleChannel: SX_PROP,
    styleChannels: ["sx"],
    renderPass: (theme, dark) => makeRenderPass(theme, dark ?? false),
    codegenModule: "@mui/material",
    themeToNative: (theme, dark) => muiThemeOptions(theme, dark),
    canvasBundleSpec: {
      moduleBase: "@mui/material",
      // Only the MUI-source components bundle from `@mui/material`; the reused
      // velloo helpers (Icon, …) aren't subpaths of it. They render in SSR; the
      // exact-installed client mount is the MUI surface.
      componentIds: MUI_MANIFEST.filter((c) => c.source === "mui").map((c) => c.id),
      overlayIds: ["Dialog", "Menu", "Popover", "Drawer", "Snackbar"],
      emotionKey: "vmui",
      stylesModule: "@mui/material/styles",
    },
  };
}

/** The id used in `Library.id` to select this provider. */
export const MUI_PROVIDER_ID = "mui" as const;

export { muiThemeFrom, muiThemeOptions } from "./theme.ts";
