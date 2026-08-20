import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FrameworkAdapter, type Manifest, SX_PROP } from "@velloo/provider";
import { MUI_MANIFEST } from "./manifest.ts";
import { makeRenderPass } from "./render-pass.ts";
import { registry } from "./registry.ts";

/**
 * Material UI v6 provider — a first-class FrameworkAdapter (framework-native
 * migration; see docs/framework-native.md). MUI ships as a velloo dependency
 * (pre-bundle), so its components SSR in-process against the shared monorepo
 * React; the adapter's emotion `renderPass` extracts the critical CSS. Styling
 * is the `sx` prop (not Tailwind), and the theme projects velloo tokens onto a
 * MUI `createTheme`.
 *
 * Still landing in follow-on Phase-3 increments: canvas-safe overlay wrappers
 * (Dialog/Menu/Popover/Snackbar), a `.d.ts`-driven manifest generator, install
 * selection in `velloo init`, Pulse-MUI, and idiomatic `sx`/`createTheme` codegen.
 */

export const MUI_VERSION = "6" as const;
const here = dirname(fileURLToPath(import.meta.url));

/** Resolve the provider src (Tailwind entry + sources), from dev + the bundled CLI. */
function resolveSrcDir(): string {
  const dev = join(here, "..", "src");
  const candidates = [process.env.VELLOO_MUI_SRC, join(here, "pkgs", "provider-mui", "src"), dev].filter(
    (p): p is string => Boolean(p),
  );
  return candidates.find((d) => existsSync(join(d, "tailwind-entry.css"))) ?? dev;
}
const srcDir = resolveSrcDir();

export function createProvider(): FrameworkAdapter {
  return {
    id: "mui",
    version: MUI_VERSION,
    label: "Material UI v6",
    componentsDir: srcDir,
    styleEntryPath: join(srcDir, "tailwind-entry.css"),
    registry,
    loadManifest: async (): Promise<Manifest> => MUI_MANIFEST,
    styleChannel: SX_PROP,
    renderPass: (theme) => makeRenderPass(theme),
  };
}

/** The id used in `Library.id` to select this provider. */
export const MUI_PROVIDER_ID = "mui" as const;
