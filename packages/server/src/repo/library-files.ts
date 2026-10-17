import type { FrameworkAdapter } from "@velloo/provider";
import type { MutationContext } from "../mutations/index.ts";
import { buildingBlocks } from "./catalog.ts";

/**
 * The library components the app's own files give a design: an in-repo
 * library's components whose file the app keeps and the canvas draws from.
 *
 * The catalog calls a component installed when its file is there, so emit
 * never tells the agent to `shadcn add` over it. But a `badge.tsx` that exports
 * only the app's renamed `StatusChip` gives the design no `Badge`: the canvas
 * has nothing of the app's to draw it from, and checking it reported a
 * "problem" setup could never fix.
 */
export async function libraryComponentsFromAppFiles(ctx: MutationContext): Promise<Set<string>> {
  const config = ctx.folder.config;
  if (config.libraries[config.defaultLibrary]?.source !== "in-repo") return new Set();
  const provider = ctx.defaultProvider as FrameworkAdapter;
  const hostCatalog = provider.catalog ? await provider.catalog().catch(() => []) : [];
  const installed = new Set(hostCatalog.filter((e) => e.installed).map((e) => e.id));
  if (installed.size === 0 || !provider.canvasBundleSpec) return installed;
  const specs = await Promise.resolve(provider.canvasBundleSpec.components([...installed])).catch(
    () => [],
  );
  for (const spec of specs) {
    if (spec.sources.every((source) => source.fidelity === "fallback")) installed.delete(spec.id);
  }
  return installed;
}

/**
 * Every component the app gives a design, by the id it composes with: the
 * library families its files provide, then its own building blocks — the set
 * `check_components` mounts.
 */
export async function componentsTheAppGives(ctx: MutationContext): Promise<string[]> {
  const fromFiles = await libraryComponentsFromAppFiles(ctx);
  const manifest = fromFiles.size > 0 ? await ctx.defaultProvider.loadManifest() : [];
  const families = manifest
    .filter((c) => fromFiles.has(c.id) && (c.family === undefined || c.family === c.id))
    .map((c) => c.id);
  const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
  return [...families, ...(catalog ? buildingBlocks(catalog).map((entry) => entry.id) : [])];
}
