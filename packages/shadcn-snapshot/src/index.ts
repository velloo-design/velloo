import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "./manifest.ts";

export type { ComponentDescriptor, Manifest, PropDescriptor } from "./manifest.ts";
export { type ComponentRef, isKnownComponent, registry } from "./registry.ts";

import pkg from "../package.json" with { type: "json" };

export const snapshotVersion: string = (pkg as { snapshotVersion: string }).snapshotVersion;

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

/**
 * Pre-compiled Tailwind CSS for the bundled components. Read at first access.
 * Built by `bun run build` in this package.
 */
export async function loadCss(): Promise<string> {
  const file = Bun.file(join(distDir, "styles.css"));
  if (!(await file.exists())) {
    throw new Error(
      `@velloo/shadcn-snapshot: dist/styles.css missing. Run \`bun run build\` in packages/shadcn-snapshot.`,
    );
  }
  return file.text();
}

/**
 * Prop manifest extracted from the vendored sources via ts-morph at build time.
 */
export async function loadManifest(): Promise<Manifest> {
  const file = Bun.file(join(distDir, "manifest.json"));
  if (!(await file.exists())) {
    throw new Error(
      `@velloo/shadcn-snapshot: dist/manifest.json missing. Run \`bun run build\` in packages/shadcn-snapshot.`,
    );
  }
  return (await file.json()) as Manifest;
}
