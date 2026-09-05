import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { ComponentProvider, ProviderLoader } from "@velloo/provider";
import {
  CSS_FRAMEWORK_CHANNEL,
  createProviderLoader,
  styleChannelOf,
  UnknownProviderError,
} from "@velloo/provider";
import type { Config, HostApp, Library } from "@velloo/schema";

/**
 * Build the loader the server uses to resolve `Library` → provider.
 * `"shadcn-upstream"` renders from the snapshot registry bundled with
 * the binary (real components install into the host app); `"none"` and
 * `"mui"` are fully bundled.
 */
export function createServerProviderLoader(folderRoot?: string, hostApp?: HostApp): ProviderLoader {
  // The upstream provider installs into (and reads installed-status from) the
  // host app. Absent `hostApp.root` ⇒ the conventional `<appRoot>/velloo`
  // layout puts the app one level above the design folder.
  const hostAppRoot = folderRoot
    ? hostApp?.root
      ? resolve(folderRoot, hostApp.root)
      : resolve(folderRoot, "..")
    : undefined;
  // Every factory dynamic-imports its provider package: a folder only pays
  // for the frameworks it actually registers, and the bundled CLI splits each
  // provider (antd, MUI, chakra, the shadcn snapshot) into a lazy chunk that
  // never loads for other folders. Keep these imports dynamic — a static
  // import here puts the whole framework back into the eager bundle.
  return createProviderLoader({
    none: async () => (await import("@velloo/provider-none")).createProvider(),
    // MUI is a first-class FrameworkAdapter: real MUI components SSR'd
    // in-process, sx styling, emotion render pass.
    mui: async () => (await import("@velloo/provider-mui")).createProvider(),
    // Ant Design v5, same stance: real antd components SSR'd in-process,
    // inline-`style` channel, cssinjs render pass.
    antd: async () => (await import("@velloo/provider-antd")).createProvider(),
    // Chakra UI v2, same stance: real chakra components SSR'd in-process,
    // `sx` channel, emotion render pass.
    chakra: async () => (await import("@velloo/provider-chakra")).createProvider(),
    // shadcn-upstream — components fetched from the official
    // registry, deposited at the user's chosen location, and the canvas
    // renders against the cached manifest. `componentsPath` resolves to
    // the cache root so `loadManifest` and the JIT scan target follow
    // the install location.
    "shadcn-upstream": async (library) => {
      const cacheDir = resolveUpstreamCacheDir(library, folderRoot);
      return (await import("@velloo/provider-shadcn-upstream")).createProvider({
        version: library.version,
        ...(cacheDir ? { cacheDir } : {}),
        ...(hostAppRoot ? { hostAppRoot } : {}),
      });
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
  if (isAbsolute(path)) return library.source === "in-repo" || existsSync(path) ? path : null;
  if (!folderRoot) return null;
  const abs = resolve(folderRoot, path);
  return library.source === "in-repo" || existsSync(abs) ? abs : null;
}

/**
 * Resolve every library in a multi-library config to a concrete
 * `ComponentProvider`. Throws (via the loader) on the first unknown
 * provider id; otherwise returns a map keyed by `libraryId` plus the
 * resolved default provider. `ConfigSchema` guarantees the shape
 * (libraries present, defaultLibrary a member).
 */
export async function resolveProviders(
  config: Config,
  folderRoot: string,
  loader?: ProviderLoader,
): Promise<{ providers: Record<string, ComponentProvider>; defaultProvider: ComponentProvider }> {
  const effective = loader ?? createServerProviderLoader(folderRoot, config.hostApp);
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
  // Coherence guard for the CSS-framework axis: the chosen
  // styling must be a channel at least one registered library supports.
  // shadcn + "none" is nonsensical (shadcn IS Tailwind) and is rejected here.
  if (config.styling) {
    const css = config.styling.framework;
    const wanted = CSS_FRAMEWORK_CHANNEL[css];
    const supported = Object.values(providers).some((p) => styleChannelOf(p, css).kind === wanted);
    if (!supported) {
      const libs = Object.values(config.libraries)
        .map((l) => l.id)
        .join(", ");
      throw new Error(
        `velloo: config.styling.framework "${css}" isn't supported by any registered ` +
          `library (${libs}). shadcn and MUI carry their own styling; only the ` +
          `no-framework library can pair with "none". Fix the CSS framework or library ` +
          "in .design/config.json.",
      );
    }
  }
  return { providers, defaultProvider };
}
