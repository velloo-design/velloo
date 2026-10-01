import { join } from "node:path";
import type { Config } from "@velloo/schema";
import {
  createCaptureMount,
  type DesignFolder,
  extraThemeBlock,
  findHostTailwindConfig,
  LiveBundler,
  liveExtensions,
  loadDesignFolder,
  resolveProviders,
  TailwindJit,
} from "@velloo/server";

/**
 * Everything a one-shot headless render of a design folder needs — the folder
 * at an arbitrary path, its providers, a Tailwind build, and the two things a
 * daemon would otherwise supply: the client mount for the app's own components
 * and the live-island bundle. Without those last two a CLI capture quietly
 * disagrees with the canvas on the same design.
 */

type Providers = Awaited<ReturnType<typeof resolveProviders>>;

/** A folder's compiled live-island module, as a one-shot capture serves it. */
export interface LiveModule {
  /** Null when nothing compiled: the page is better off without the script tag than with a 404 behind it. */
  code: string | null;
  /** Live components that failed to compile — the capture is poorer, not wrong. */
  warnings: string[];
}

export interface FolderPipeline {
  folderPath: string;
  design: DesignFolder;
  config: Config;
  providers: Providers["providers"];
  defaultProvider: Providers["defaultProvider"];
  jit: TailwindJit;
  snapshotCss: string;
  /** Client mount for the app's own components, plus the route that serves it. */
  capture: ReturnType<typeof createCaptureMount>;
  /**
   * The live-island module, compiled on first call. Only a capture loads it, so
   * a standalone `.html` never pays for the build or hears about its failures.
   */
  liveModule(): Promise<LiveModule>;
}

/**
 * A live bundler for a consumer that serves one file rather than a route per
 * host app: `velloo publish`, and the CLI asset server behind `velloo export` /
 * `velloo render`. Null when the folder declares no live islands. Share the
 * instance with whoever wires Tailwind — its `hostSourceDirs()` feeds the JIT —
 * instead of bundling twice.
 */
export function createOneShotLiveBundler(root: string, config: Config): LiveBundler | null {
  if (Object.keys(liveExtensions(config.extensions)).length === 0) return null;
  const minify = true;
  // Each host app inlined as a data-URL import: there is no route per app to fetch.
  const inline = true;
  return new LiveBundler(
    root,
    () => config,
    () => liveExtensions(config.extensions),
    minify,
    inline,
  );
}

export async function buildLiveModule(bundler: LiveBundler): Promise<LiveModule> {
  const bundle = await bundler.build();
  return {
    // A zero-length module is a build that produced nothing at all.
    code: bundle.code.length > 0 ? bundle.code : null,
    warnings: bundle.errors.map((error) => `live-island: ${error.message}`),
  };
}

/** Load a design folder and everything a headless render of it needs. */
export async function loadPipeline(folderPath: string): Promise<FolderPipeline> {
  const design = await loadDesignFolder(folderPath);
  const config = design.config;
  const { providers, defaultProvider } = await resolveProviders(config, folderPath);
  const capture = createCaptureMount(design, providers, defaultProvider);
  const liveBundler = createOneShotLiveBundler(folderPath, config);
  const jit = new TailwindJit(
    Object.values(providers),
    join(folderPath, "screens"),
    undefined,
    () => extraThemeBlock(design),
    // The same set the daemon scans: a utility used only inside a live or
    // repository component compiles nowhere else, and the capture would mount
    // the real component with none of its classes.
    () => [...(liveBundler?.hostSourceDirs() ?? []), ...capture.sourceDirs()],
    () => findHostTailwindConfig(folderPath, config.hostApp),
    config.styling?.framework,
  );
  const snapshotCss = await jit.build();
  let live: Promise<LiveModule> | undefined;
  return {
    folderPath,
    design,
    config,
    providers,
    defaultProvider,
    jit,
    snapshotCss,
    capture,
    liveModule() {
      live ??= liveBundler
        ? buildLiveModule(liveBundler)
        : Promise.resolve({ code: null, warnings: [] });
      return live;
    },
  };
}
