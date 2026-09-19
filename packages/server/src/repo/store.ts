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
    owned: (specifier, resolved) => {
      const pkg = packageOf(specifier);
      for (const adapter of adapters) {
        if (adapter.ownedModules?.packages?.includes(pkg)) return true;
        if (!resolved) continue;
        for (const dir of adapter.ownedModules?.dirs?.() ?? []) {
          const root = resolve(dir);
          if (resolved === root || resolved.startsWith(root + sep)) return true;
        }
      }
      return false;
    },
  });
}
