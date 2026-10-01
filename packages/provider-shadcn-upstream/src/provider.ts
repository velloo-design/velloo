import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { helperSourcePath } from "@velloo/helpers/paths";
import {
  type CanvasComponentSpec,
  type CatalogEntry,
  type FrameworkAdapter,
  type Manifest,
  TAILWIND_CLASSNAME,
} from "@velloo/provider";
import {
  componentsDir as snapshotComponentsDir,
  entryCssPath as snapshotEntryCssPath,
  registry as snapshotRegistry,
  snapshotVersion,
} from "@velloo/shadcn-snapshot";
import { enrichManifestFromHost } from "./host-manifest.ts";
import { exportsName, hostComponentFile } from "./host-source.ts";
import { addNameIndex, findUiDir, installedAddNames } from "./install.ts";
import { readManifest } from "./manifest.ts";

/**
 * Build the `shadcn-upstream` framework adapter.
 *
 * SSR remains backed by the embedded snapshot so a folder always opens. For
 * the interactive canvas, the adapter builds a mixed registry per screen:
 * client-safe components are imported directly from the host app, portal and
 * runtime-heavy families use explicit canvas-safe counterparts, and a broken
 * or missing host file falls back independently rather than taking down the
 * whole screen. Tailwind scans the host source and the manifest is enriched
 * from its common CVA variants and explicit props.
 */
export interface CreateUpstreamProviderOptions {
  /**
   * Cache directory where fetched components live, e.g.
   * `~/.velloo/providers/shadcn-upstream@2026.05.26/` or a
   * user-app path like `../apps/web/src/components/`. The provider
   * uses this for componentsDir and the manifest source.
   */
  cacheDir?: string;
  /** Version string for the provider's `version` field — defaults to the snapshot's date. */
  version?: string;
  /**
   * Absolute path to the user's app, used only to report which components are
   * already installed there. Design composition never writes to this path.
   */
  hostAppRoot?: string;
}

export function createProvider(opts: CreateUpstreamProviderOptions = {}): FrameworkAdapter {
  const cacheDir = opts.cacheDir;
  const plannedUiDir = cacheDir ? join(cacheDir, "ui") : undefined;
  const hostUiDir = (): string | null =>
    plannedUiDir && existsSync(plannedUiDir)
      ? plannedUiDir
      : opts.hostAppRoot
        ? findUiDir(opts.hostAppRoot)
        : null;
  // SSR always renders `snapshotRegistry`, so the snapshot's own sources must
  // always reach the Tailwind JIT — pointing this at a planned-but-empty host
  // directory drops every shadcn default class (bg-primary, rounded-md, …) from
  // the compiled CSS. The app's installed files are scanned too, contributed
  // separately through `canvasBundleSpec.sourceDirs()`.
  const componentsDir = snapshotComponentsDir;
  const version = opts.version ?? snapshotVersion;
  const loadManifest = async (): Promise<Manifest> => {
    if (cacheDir && existsSync(join(cacheDir, "manifest.json"))) {
      return enrichManifestFromHost(await readManifest(cacheDir), hostUiDir());
    }
    // Fall back to the snapshot's manifest if no cache was generated
    // (in-process tests, dev shortcuts).
    const { loadManifest: snapshotManifest } = await import("@velloo/shadcn-snapshot");
    return enrichManifestFromHost(await snapshotManifest(), hostUiDir());
  };
  return {
    id: "shadcn-upstream",
    version,
    componentsDir,
    styleEntryPath: snapshotEntryCssPath,
    registry: snapshotRegistry,
    loadManifest,
    label: `shadcn (upstream @ ${version})`,
    styleChannel: TAILWIND_CLASSNAME,
    styleChannels: ["tailwind-classname"],
    mcpIntro: () => [
      '**This folder targets shadcn/ui with Tailwind.** The canvas imports client-safe components directly from the app\'s `components/ui`, adapts overlay families to stay inline, and falls back per component when a file is missing — `component_status` says which, before you claim fidelity. Style with a className string: `update_props { style: "flex gap-4 p-6" }`.',
      "",
    ],
    // Real installed-status per catalog() call: a component's shadcn family
    // file exists in the app's ui dir. Canvas fidelity is reported separately
    // because installed source can still need an adapted or fallback render.
    catalog: async (): Promise<CatalogEntry[]> => {
      const manifest = await loadManifest();
      const addNameOf = addNameIndex(manifest);
      const shadcn = manifest.filter((c) => c.source !== "velloo");
      // The same ui dir the canvas mounts from — the configured components
      // path first — so "installed" and "rendered exactly" can't disagree.
      const present = installedAddNames(hostUiDir());
      return shadcn.map((c) => {
        const addName = addNameOf(c.id);
        return {
          id: c.id,
          installed: present.has(addName),
          importPath: `@/components/ui/${addName}`,
        };
      });
    },
    // The app's `ui/` files are this adapter's catalog, already mounted exactly.
    ownedModules: {
      dirs: () => {
        const uiDir = hostUiDir();
        return uiDir ? [uiDir] : [];
      },
      // The canvas mounts an app file for a name only when it is that name's
      // shadcn family file (`hostComponentFile`); the same name exported from
      // any other file is the app's own component.
      supplies: (file, exportName) => {
        const family = basename(file).replace(/\.[jt]sx?$/, "");
        const counterpart = join(snapshotComponentsDir, "ui", `${family}.tsx`);
        return familyExports(counterpart).has(exportName);
      },
    },
    canvasBundleSpec: {
      styleRuntime: { kind: "none" },
      components: async (ids) => {
        const manifest = await loadManifest();
        const addNameOf = addNameIndex(manifest);
        const sourceById = new Map(manifest.map((entry) => [entry.id, entry.source]));
        const uiDir = hostUiDir();
        return ids.flatMap((id): CanvasComponentSpec[] => {
          if (sourceById.get(id) === "velloo") {
            const path = helperSourcePath(id);
            return path
              ? [
                  {
                    id,
                    sources: [
                      {
                        importPath: path,
                        exportName: id,
                        fidelity: "fallback" as const,
                        note: "Velloo helper used alongside repo-backed shadcn components.",
                      },
                    ],
                  },
                ]
              : [];
          }
          if (!sourceById.has(id)) return [];
          const addName = addNameOf(id);
          const snapshotPath = join(snapshotComponentsDir, "ui", `${addName}.tsx`);
          if (CANVAS_ADAPTED_FAMILIES.has(addName)) {
            return [
              {
                id,
                sources: [
                  {
                    importPath: snapshotPath,
                    exportName: id,
                    fidelity: "adapted" as const,
                    note: "The app component uses portals or runtime state; Velloo renders its canvas-safe counterpart inline.",
                  },
                ],
              },
            ];
          }
          const hostPath = uiDir ? hostComponentFile(uiDir, addName, id) : null;
          return [
            {
              id,
              sources: [
                ...(hostPath
                  ? [
                      {
                        importPath: hostPath,
                        exportName: id,
                        fidelity: "exact" as const,
                        preflight: true,
                        note: "Rendered directly from the app's shadcn source file.",
                      },
                    ]
                  : []),
                {
                  importPath: snapshotPath,
                  exportName: id,
                  fidelity: "fallback" as const,
                  note: hostPath
                    ? "The app source did not compile for the browser canvas; using the bundled canvas fallback."
                    : "The app does not install this component under this name (it may be renamed in its own file); using the bundled canvas fallback.",
                },
              ],
            },
          ];
        });
      },
      // The planned directory is reported even before it exists: the watcher
      // arms on it so a later `npx shadcn add` refreshes the canvas instead of
      // needing a daemon restart, and the Tailwind scan simply finds nothing
      // until it does.
      sourceDirs: () => {
        const uiDir = hostUiDir() ?? plannedUiDir;
        return uiDir ? [uiDir] : [];
      },
    },
  };
}

const CANVAS_ADAPTED_FAMILIES = new Set([
  "alert-dialog",
  "calendar",
  "carousel",
  "chart",
  "dialog",
  "dropdown-menu",
  "popover",
  "select",
  "sheet",
  "sonner",
  "tooltip",
]);

const familyExportCache = new Map<string, Set<string>>();

/** The names a bundled shadcn family file exports — empty when there is no such family. */
function familyExports(path: string): Set<string> {
  let names = familyExportCache.get(path);
  if (!names) {
    names = new Set<string>();
    try {
      const source = readFileSync(path, "utf8");
      for (const id of Object.keys(snapshotRegistry)) if (exportsName(source, id)) names.add(id);
    } catch {
      // No bundled family of this name.
    }
    familyExportCache.set(path, names);
  }
  return names;
}
