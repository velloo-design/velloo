import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { hostComponentFile } from "./host-source.ts";
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
  const hostAppRoot = opts.hostAppRoot;
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
      '**This folder targets shadcn/ui with Tailwind.** The canvas imports client-safe components directly from the app, uses named canvas-safe adaptations for portal/state-heavy families, and falls back per component when a host file is missing or cannot compile. Velloo helpers (`Box`, `Heading`, `Text`, `Icon`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Prose`) remain canvas primitives. Style through `update_props { style: "flex gap-4 p-6" }` — a Tailwind className string. Call `list_components` for the catalog and `component_status` before making a fidelity claim.',
      "",
    ],
    // Real installed-status per catalog() call: a component's shadcn family
    // file exists in the app's ui dir. Canvas fidelity is reported separately
    // because installed source can still need an adapted or fallback render.
    catalog: async (): Promise<CatalogEntry[]> => {
      const manifest = await loadManifest();
      const addNameOf = addNameIndex(manifest);
      const shadcn = manifest.filter((c) => c.source !== "velloo");
      const present = hostAppRoot ? installedAddNames(hostAppRoot) : new Set<string>();
      return shadcn.map((c) => {
        const addName = addNameOf(c.id);
        return {
          id: c.id,
          installed: present.has(addName),
          importPath: `@/components/ui/${addName}`,
        };
      });
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
