import { type FrameworkAdapter, type Manifest, TAILWIND_CLASSNAME } from "@velloo/provider";
import { componentsDir, entryCssPath, manifestPath, snapshotVersion } from "./paths.ts";
import { registry } from "./registry.ts";

export type { ComponentDescriptor, Manifest, PropDescriptor } from "./manifest.ts";
export { componentsDir, entryCssPath, snapshotVersion } from "./paths.ts";
export { registry } from "./registry.ts";

/**
 * Prop manifest extracted from the vendored sources via ts-morph at build time.
 */
export async function loadManifest(): Promise<Manifest> {
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    throw new Error(
      `@velloo/shadcn-snapshot: dist/manifest.json missing. Run \`bun run build\` in packages/shadcn-snapshot.`,
    );
  }
  return (await file.json()) as Manifest;
}

/**
 * Build a `ComponentProvider` instance for this snapshot. Optionally
 * overrides the on-disk `componentsDir` when the user installed the
 * snapshot files outside the binary (in-repo or cache mode) — the
 * runtime registry stays bundled with velloo (so what the canvas
 * renders is byte-identical across folders), but the JIT scan target
 * follows the install location so user customizations contribute to
 * the compiled CSS.
 */
export function createProvider(opts: { componentsDir?: string } = {}): FrameworkAdapter {
  return {
    id: "shadcn-react",
    version: snapshotVersion,
    componentsDir: opts.componentsDir ?? componentsDir,
    styleEntryPath: entryCssPath,
    registry,
    loadManifest,
    label: `shadcn-react ${snapshotVersion}`,
    styleChannel: TAILWIND_CLASSNAME,
    styleChannels: ["tailwind-classname"],
  };
}
