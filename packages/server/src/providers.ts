import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ComponentProvider, ProviderLoader } from "@velloo/provider";
import { createProviderLoader, UnknownProviderError } from "@velloo/provider";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createNoLibProvider } from "@velloo/provider-none";
import { createProvider as createUpstreamProvider } from "@velloo/provider-shadcn-upstream";
import type { Config, Library } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";

/**
 * Build the loader the server uses to resolve `Library` → provider.
 *
 * Sprint X+1 supports "binary" (snapshot lives in the velloo binary),
 * "in-repo" / "cache" (snapshot was copied to disk at init — the JIT
 * scans that location so user customizations contribute to compiled
 * CSS). The runtime registry stays bundled regardless. Sprint X+2 will
 * add `"none"` and `"mui"` factories alongside.
 */
export function createServerProviderLoader(folderRoot?: string): ProviderLoader {
  return createProviderLoader({
    "shadcn-react": (library) => {
      // For non-binary modes the components are on disk; point the JIT
      // at that path so any user edits flow into compiled Tailwind.
      // We only honor the override when the directory actually exists
      // — falling back to the bundled scan target keeps `velloo run`
      // working even if the install was deleted out from under us.
      if (library.source !== "binary" && library.componentsPath !== "binary") {
        const abs = resolveComponentsPath(library.componentsPath, folderRoot);
        if (abs && existsSync(abs)) {
          return createShadcnProvider({ componentsDir: abs });
        }
      }
      return createShadcnProvider();
    },
    none: () => createNoLibProvider(),
    // MUI is a first-class FrameworkAdapter (framework-native migration): real
    // MUI components SSR'd in-process, sx styling, emotion render pass. See
    // docs/framework-native.md.
    mui: () => createMuiProvider(),
    // Sprint Z: shadcn-upstream — components fetched from the official
    // registry, deposited at the user's chosen location, and the canvas
    // renders against the cached manifest. `componentsPath` resolves to
    // the cache root so `loadManifest` and the JIT scan target follow
    // the install location.
    "shadcn-upstream": (library) => {
      const cacheDir = resolveUpstreamCacheDir(library, folderRoot);
      return createUpstreamProvider(
        cacheDir ? { cacheDir, version: library.version } : { version: library.version },
      );
    },
  });
}

/**
 * Resolve `library.componentsPath` to an absolute directory for the
 * shadcn-upstream provider. The path can be relative (relative to the
 * design folder), absolute, or `~/`-prefixed. Returns `null` when the
 * path is the binary-only marker or can't be resolved.
 */
function resolveUpstreamCacheDir(library: Library, folderRoot: string | undefined): string | null {
  const path = library.componentsPath;
  if (!path || path === "binary") return null;
  if (path.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (!home) return null;
    const abs = resolve(home, path.slice(2));
    return existsSync(abs) ? abs : null;
  }
  if (isAbsolute(path)) return existsSync(path) ? path : null;
  if (!folderRoot) return null;
  const abs = resolve(folderRoot, path);
  return existsSync(abs) ? abs : null;
}

function resolveComponentsPath(
  componentsPath: string,
  folderRoot: string | undefined,
): string | null {
  if (componentsPath === "" || componentsPath === "binary") return null;
  if (componentsPath.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (!home) return null;
    return resolve(home, componentsPath.slice(2));
  }
  if (isAbsolute(componentsPath)) return componentsPath;
  if (!folderRoot) return null;
  return resolve(folderRoot, componentsPath);
}

/**
 * Migration shim: rewrite legacy `library.source` vocabulary to the
 * Sprint-X canonical values. Existing Pulse-shaped folders persist
 * `"embedded:shadcn"` (default-mode) or `"registry:shadcn"` (the older
 * file-copy mode, since reverted). Both mean "the snapshot shipping
 * inside the binary" today, so they normalize to `"binary"`.
 */
export function migrateLibrarySource(library: Library): Library {
  switch (library.source) {
    case "embedded:shadcn":
    case "registry:shadcn":
      return { ...library, source: "binary", componentsPath: "binary" };
    default:
      return library;
  }
}

/** Library id assigned to a legacy single-library config when it gets migrated. */
export const DEFAULT_LEGACY_LIBRARY_ID = "default";

/**
 * Promote a legacy single-library config to the Sprint-Y multi-library
 * shape. Called once at `loadDesignFolder` time so the rest of the
 * server only sees the canonical shape. Does not rewrite the on-disk
 * file — that happens on the next config-modifying mutation (e.g.
 * `add_extension`) so loads stay side-effect-free.
 *
 * Idempotent: a config that's already in multi-library form passes
 * through unchanged.
 */
export function migrateConfig(config: Config): Config {
  if (config.libraries && config.defaultLibrary) {
    // Already multi-library. Still apply the legacy-source migration
    // to each registered library so older sources normalize.
    const libraries = Object.fromEntries(
      Object.entries(config.libraries).map(([id, lib]) => [id, migrateLibrarySource(lib)]),
    );
    return { ...config, libraries };
  }
  if (!config.library) {
    // Schema-level `.refine()` should have rejected this; defend
    // anyway so a hand-edited config produces a meaningful error.
    throw new Error(
      "velloo: config has neither `library` (legacy) nor `libraries` + `defaultLibrary` (multi). " +
        "Cannot resolve any provider.",
    );
  }
  const id = DEFAULT_LEGACY_LIBRARY_ID;
  const migrated = migrateLibrarySource(config.library);
  return {
    ...config,
    library: undefined,
    libraries: { [id]: migrated },
    defaultLibrary: id,
  };
}

/**
 * Resolve every library in a multi-library config to a concrete
 * `ComponentProvider`. Throws (via the loader) on the first unknown
 * provider id; otherwise returns a map keyed by `libraryId` plus the
 * resolved default provider.
 *
 * Assumes `config` has been through `migrateConfig` first.
 */
export async function resolveProviders(
  config: Config,
  folderRoot: string,
  loader?: ProviderLoader,
): Promise<{ providers: Record<string, ComponentProvider>; defaultProvider: ComponentProvider }> {
  if (!config.libraries || !config.defaultLibrary) {
    throw new Error(
      "velloo: resolveProviders requires a migrated config. Call migrateConfig() first.",
    );
  }
  const effective = loader ?? createServerProviderLoader(folderRoot);
  const providers: Record<string, ComponentProvider> = {};
  for (const [libraryId, library] of Object.entries(config.libraries)) {
    try {
      providers[libraryId] = await effective(library);
    } catch (err: unknown) {
      if (err instanceof UnknownProviderError) {
        throw new Error(
          `velloo: this binary doesn't know how to load library "${err.id}" ` +
            `(registered as "${libraryId}"). ` +
            `Upgrade velloo or pick a supported provider in .design/config.json.`,
        );
      }
      throw err;
    }
  }
  const defaultProvider = providers[config.defaultLibrary];
  if (!defaultProvider) {
    throw new Error(
      `velloo: defaultLibrary "${config.defaultLibrary}" doesn't match any registered library.`,
    );
  }
  return { providers, defaultProvider };
}
