import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentProvider, Manifest } from "@velloo/provider";
import { NONE_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";

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
function resolveSrcDir(): string {
  const dev = join(here, "..", "src");
  const candidates = [
    process.env.VELLOO_NOLIB_SRC,
    join(here, "pkgs", "provider-none", "src"),
    dev,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((d) => existsSync(join(d, "tailwind-entry.css"))) ?? dev;
}
const srcDir = resolveSrcDir();

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
export function createProvider(): ComponentProvider {
  return {
    id: "none",
    version: noLibVersion,
    componentsDir,
    styleEntryPath: entryCssPath,
    registry,
    loadManifest,
    label: `none ${noLibVersion}`,
  };
}
