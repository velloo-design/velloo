import { resolve, sep } from "node:path";
import type { ComponentProvider, FrameworkAdapter } from "@velloo/provider";
import type { DesignFolder } from "../design-folder.ts";
import { RepoComponents } from "./catalog.ts";
import { packageOf } from "./discover.ts";

/**
 * The folder's repository-component catalog, bounded by its providers: their
 * component ids are reserved (a same-named repository family gets a qualified
 * id) and the modules they own are never re-cataloged.
 */
export function createRepoComponents(
  folder: DesignFolder,
  providers: Record<string, ComponentProvider>,
): RepoComponents {
  const adapters = Object.values(providers) as FrameworkAdapter[];
  return new RepoComponents({
    folderRoot: folder.root,
    config: () => folder.config,
    reservedIds: () =>
      new Set([
        ...adapters.flatMap((adapter) => Object.keys(adapter.registry)),
        ...Object.keys(folder.config.extensions ?? {}),
      ]),
    // An adapter owns a module, but only the components it actually supplies:
    // an app's own `Panel` living in the shadcn `ui/` dir beside `Card` is the
    // app's, and is exactly what an agent would otherwise rebuild from stock
    // primitives. With no name (following an import), the module is its own.
    owned: (specifier, resolved, exportName) => {
      const pkg = packageOf(specifier);
      for (const adapter of adapters) {
        const inModule =
          adapter.ownedModules?.packages?.includes(pkg) === true ||
          (resolved !== null &&
            (adapter.ownedModules?.dirs?.() ?? []).some((dir) => {
              const root = resolve(dir);
              return resolved === root || resolved.startsWith(root + sep);
            }));
        if (!inModule) continue;
        if (exportName === undefined || exportName in adapter.registry) return true;
      }
      return false;
    },
  });
}
