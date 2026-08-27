import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type FrameworkAdapter, type Manifest, TAILWIND_CLASSNAME } from "@velloo/provider";
import { resolveProviderSrcDir } from "@velloo/provider/src-dir";
import { NONE_INLINE_INTRO, NONE_INTRO } from "./intro.ts";
import { NONE_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";
import { inlineRegistry } from "./registry-inline.ts";

export { Box, Button, Card, Container, Input, Stack } from "./components.tsx";
export { NONE_MANIFEST } from "./manifest.ts";
export { registry } from "./registry.ts";

/**
 * Version of the no-library primitive set. Bumped on breaking changes
 * to the Box/Stack/Button surface (a renamed prop, a removed variant,
 * a behavior change).
 */
export const noLibVersion = "0.1.0";

const here = dirname(fileURLToPath(import.meta.url));

/** Component sources + Tailwind entry CSS. Resolves from source and from the
 *  bundled CLI (build.ts copies them to `<dist>/pkgs/provider-none/src`). */
const srcDir = resolveProviderSrcDir(here, "provider-none", process.env.VELLOO_NOLIB_SRC);

/** Absolute path to the Tailwind entry CSS shipped with the no-library provider. */
export const entryCssPath: string = join(srcDir, "tailwind-entry.css");

/** Absolute path to the no-library provider's component sources for JIT scanning. */
export const componentsDir: string = srcDir;

export async function loadManifest(): Promise<Manifest> {
  return NONE_MANIFEST;
}

/**
 * Build the no-library `ComponentProvider`. Identical interface shape
 * to the shadcn provider — the renderer / JIT / codegen / canvas don't
 * know which one is active; they just consume the contract.
 */
export function createProvider(): FrameworkAdapter {
  return {
    id: "none",
    version: noLibVersion,
    componentsDir,
    styleEntryPath: entryCssPath,
    registry,
    loadManifest,
    label: `none ${noLibVersion}`,
    // Default to Tailwind (existing folders); a folder whose `config.styling`
    // is `none` resolves to the inline-`style` channel instead.
    styleChannel: TAILWIND_CLASSNAME,
    styleChannels: ["tailwind-classname", "style"],
    mcpIntro: (channel) => [...(channel === "style" ? NONE_INLINE_INTRO : NONE_INTRO)],
    // Inline-styled primitives for the `style` channel; Tailwind-classed for
    // every other channel. Lets a `none/none` folder paint with the JIT off.
    registryForChannel: (kind) => (kind === "style" ? inlineRegistry : registry),
  };
}
