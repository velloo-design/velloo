import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentProvider, Manifest } from "@velloo/provider";
import { NONE_MANIFEST } from "./manifest.ts";
import { registry } from "./registry.ts";

export { Box, Button, Card, Container, Input, Stack } from "./components.tsx";
export { NONE_MANIFEST } from "./manifest.ts";
export { isKnownComponent, registry } from "./registry.ts";

/**
 * Version of the no-library primitive set. Bumped on breaking changes
 * to the Box/Stack/Button surface (a renamed prop, a removed variant,
 * a behavior change).
 */
export const noLibVersion = "0.1.0";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

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
