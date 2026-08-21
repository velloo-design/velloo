import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CatalogEntry, catalogFromManifest, type FrameworkAdapter } from "@velloo/provider";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import { providerForScreen } from "../../mutations/lookup.ts";

type McpResult = { content: { type: "text"; text: string }[]; isError?: true };
const jsonResult = (value: unknown): McpResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const errorResult = (value: unknown): McpResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/** The active library's catalog with installed-status — adapter `catalog()` or a manifest fallback. */
async function catalogFor(provider: FrameworkAdapter): Promise<CatalogEntry[]> {
  if (provider.catalog) return provider.catalog();
  // No explicit catalog ⇒ a fully-bundled provider: derive it from the manifest,
  // everything installed. The importPath is the library id (the agent already
  // knows where its app imports library components from).
  const manifest = await provider.loadManifest();
  return catalogFromManifest(manifest, { importPath: provider.id });
}

/**
 * `install_component` — the user-flow verb "MCP knows all library components and
 * which aren't installed so it can install them". Resolves the active library's
 * catalog: a component that's already present (every shipped adapter bundles its
 * whole set) reports `installed: true` + its importPath; an uninstalled one is
 * installed via the adapter's `installComponent` when it has an installer
 * (shadcn-upstream's per-component fetch), else reported as unavailable; an
 * unknown id errors with the catalog so the agent can pick a real one.
 */
export function registerCatalogTools(mcp: McpServer, ctx: MutationContext): void {
  mcp.registerTool(
    "install_component",
    {
      description:
        "Ensure a library component is available to the active framework (the existing flow's 'MCP knows all components + which aren't installed'). Returns `installed: true` + its import path when it's already present (every shipped library bundles its full set, so this is the common case — just reference the id via $ref); installs it via the adapter when it has a per-component installer; errors with the catalog for an unknown id. `screenId` picks the library (a screen's `library`); omitted ⇒ the folder default.",
      inputSchema: {
        componentId: z.string(),
        screenId: z.string().optional(),
      },
    },
    async (args) => {
      const screen = args.screenId ? ctx.folder.screens.get(args.screenId) : undefined;
      const provider = (
        screen ? providerForScreen(ctx, screen) : ctx.defaultProvider
      ) as FrameworkAdapter;
      const catalog = await catalogFor(provider);
      const entry = catalog.find((e) => e.id === args.componentId);
      if (!entry) {
        return errorResult({
          error: `Unknown component "${args.componentId}" in library "${provider.id}".`,
          available: catalog.map((e) => e.id),
        });
      }
      if (entry.installed) {
        return jsonResult({
          ok: true,
          componentId: entry.id,
          installed: true,
          importPath: entry.importPath,
          note: `Already available — reference it directly via $ref: "${entry.id}".`,
        });
      }
      if (provider.installComponent) {
        try {
          await provider.installComponent(entry.id, {
            folderRoot: ctx.folder.root,
            target: "app",
          });
          return jsonResult({
            ok: true,
            componentId: entry.id,
            installed: true,
            importPath: entry.importPath,
          });
        } catch (err) {
          return errorResult({
            error: `install of "${entry.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
      return jsonResult({
        ok: false,
        componentId: entry.id,
        installed: false,
        note: `"${entry.id}" is in the catalog but not installed, and the "${provider.id}" library has no per-component installer.`,
      });
    },
  );
}
