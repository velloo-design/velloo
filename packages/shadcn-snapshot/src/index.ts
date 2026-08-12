import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "./manifest.ts";

export type { ComponentDescriptor, Manifest, PropDescriptor } from "./manifest.ts";
export { type ComponentRef, isKnownComponent, registry } from "./registry.ts";

import pkg from "../package.json" with { type: "json" };

export const snapshotVersion: string = (pkg as { snapshotVersion: string }).snapshotVersion;

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");
const distDir = join(here, "..", "dist");

/**
 * Absolute path to the Tailwind entry CSS shipped with the snapshot. The
 * server's JIT compiler reads this and runs Tailwind v4 against the live page
 * folder so any class — including ones we haven't thought of yet — renders
 * without a hand-rolled safelist.
 */
export const entryCssPath: string = join(srcDir, "tailwind-entry.css");

/**
 * Absolute path to the snapshot's component sources. The JIT scanner reads
 * these so the canvas picks up classes used by shipped components even if no
 * page references them directly.
 */
export const componentsDir: string = join(srcDir, "components");

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
