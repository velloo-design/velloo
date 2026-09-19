import { Hono } from "hono";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import type { RepoCatalogEntry } from "../repo/catalog.ts";

/**
 * The canvas's read surface for the app's own components: the catalog the
 * Library's Repo shelves browse, and per-component fidelity from the same
 * bundler a screen mounts with (merged with what mounted frames reported).
 */
export function createRepoRouter(
  ctxFor: () => MutationContext,
  canvasBundler: CanvasBundler,
): Hono {
  const r = new Hono();

  r.get("/components", async (c) => {
    const ctx = ctxFor();
    if (!ctx.repo) return c.json({ entries: [], apps: [], warnings: [] });
    try {
      const catalog = await ctx.repo.catalog();
      return c.json({
        entries: catalog.entries.map(publicEntry),
        apps: catalog.apps.map((app) => ({
          ...(app.app ? { app: app.app } : {}),
          recipes: app.recipes,
          preview: app.preview,
          wrappers: app.wrappers.map((wrapper) => ({ name: wrapper.name, at: wrapper.at })),
        })),
        warnings: catalog.warnings,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  r.get("/status", async (c) => {
    const ctx = ctxFor();
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
    if (!ctx.repo || ids.length === 0) return c.json({ diagnostics: [] });
    const catalog = await ctx.repo.catalog().catch(() => null);
    if (!catalog)
      return c.json({ diagnostics: [], error: "The repository catalog failed to build." }, 500);
    const keys = ids
      .map((id) => catalog.byId.get(id)?.key)
      .filter((key): key is string => key !== undefined);
    if (keys.length === 0) return c.json({ diagnostics: [] });
    const result = await canvasBundler.build(ctx.folder.config.defaultLibrary, keys);
    // A shelf asks for many ids at once, but a component's runtime verdict comes
    // from a frame that mounted it: its own Library preview, or this same set.
    const runtime = [
      ...keys.flatMap((key) => canvasBundler.runtimeDiagnostics([key]) ?? []),
      ...(canvasBundler.runtimeDiagnostics(keys) ?? []),
    ];
    const byKey = new Map(result.diagnostics.map((entry) => [entry.id, { ...entry }]));
    for (const entry of runtime) byKey.set(entry.id, { ...(byKey.get(entry.id) ?? {}), ...entry });
    return c.json({
      diagnostics: [...byKey.values()]
        .filter((entry) => entry.id.startsWith("repo:"))
        .map((entry) => ({ ...entry, id: catalog.byKey.get(entry.id)?.id ?? entry.id })),
    });
  });

  return r;
}

function publicEntry(entry: RepoCatalogEntry) {
  return {
    id: entry.id,
    name: entry.name,
    key: entry.key,
    identity: entry.identity,
    source: entry.source,
    ...(entry.packageName ? { packageName: entry.packageName } : {}),
    family: entry.family,
    ...(entry.group ? { group: entry.group } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    props: entry.props,
    acceptsChildren: entry.acceptsChildren,
    ...(entry.parts ? { parts: entry.parts } : {}),
    states: entry.states,
    provenance: entry.provenance,
    ...(entry.recipe ? { recipe: entry.recipe } : {}),
    styleProps: entry.styleProps,
    ...(entry.qualifiedBecause ? { qualifiedBecause: entry.qualifiedBecause } : {}),
    ...(entry.viaFamily ? { viaFamily: true } : {}),
    ...(entry.proxy ? { proxy: entry.proxy } : {}),
  };
}
