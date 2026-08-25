import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { captureScreenshot, renderScreen } from "@velloo/renderer";
import type { Config, Screen, Theme, Viewport } from "@velloo/schema";
import {
  type DesignFolder,
  extraThemeBlock,
  findHostTailwindConfig,
  loadDesignFolder,
  migrateConfig,
  registryForScreen,
  renderPassForScreen,
  resolveProviders,
  TailwindJit,
} from "@velloo/server";
import { withAssetServer } from "../asset-server.ts";

/**
 * The before/after capture side of `velloo ci` — the same
 * renderScreen → captureScreenshot pipeline `velloo publish` ships bundle
 * screenshots through, pointed at an arbitrary design folder (the working
 * tree for 'after', a git-archive temp dir for 'before').
 *
 * Live-island extensions render their SSR placeholder here (no host bundler):
 * CI diffs design-authored pixels, and the base checkout has no host app to
 * compile against anyway.
 */

type Providers = Awaited<ReturnType<typeof resolveProviders>>;

export interface FolderPipeline {
  folderPath: string;
  design: DesignFolder;
  config: Config;
  providers: Providers["providers"];
  defaultProvider: Providers["defaultProvider"];
  jit: TailwindJit;
  snapshotCss: string;
}

/** Load a design folder and everything a headless render of it needs. */
export async function loadPipeline(folderPath: string): Promise<FolderPipeline> {
  const design = await loadDesignFolder(folderPath);
  const config = migrateConfig(design.config);
  const { providers, defaultProvider } = await resolveProviders(config, folderPath);
  const jit = new TailwindJit(
    Object.values(providers),
    join(folderPath, "screens"),
    undefined,
    () => extraThemeBlock(design),
    undefined,
    () => findHostTailwindConfig(folderPath, config.hostApp),
    config.styling?.framework,
  );
  const snapshotCss = await jit.build();
  return { folderPath, design, config, providers, defaultProvider, jit, snapshotCss };
}

/**
 * Capture full-page PNGs for the given screens into `<outDir>/<screen>.png`.
 * Returns screenId → written path. Per-screen failures warn and skip;
 * BrowserMissingError propagates (the command turns it into exit 2).
 */
export async function captureScreens(opts: {
  /** Null when the folder couldn't be loaded (e.g. base ref missing a design config). */
  pipeline: FolderPipeline | null;
  screens: Screen[];
  viewport: Viewport;
  outDir: string;
  warn: (message: string) => void;
}): Promise<Map<string, string>> {
  const { pipeline, screens, viewport, outDir, warn } = opts;
  const written = new Map<string, string>();
  // Nothing to shoot (no changed screens) or no folder to shoot from — the
  // documented "before shots skipped" degrade path. Guard BEFORE destructuring.
  if (!pipeline || screens.length === 0) return written;
  const { design, providers, defaultProvider, config, snapshotCss } = pipeline;

  await mkdir(outDir, { recursive: true });
  await withAssetServer(pipeline.folderPath, null, async (baseHref) => {
    for (const screen of screens) {
      try {
        const theme: Theme = design.theme;
        const { html } = await renderScreen(screen, theme, {
          viewport,
          snapshotCss,
          registry: registryForScreen(screen, providers, defaultProvider, config.extensions ?? {}),
          renderPass: renderPassForScreen(screen, providers, defaultProvider, theme),
          snippets: design.snippets,
          customCss: design.customCss,
          baseHref,
        });
        const { png } = await captureScreenshot({ html, viewport, fullPage: true });
        const path = join(outDir, `${screen.id}.png`);
        await mkdir(dirname(path), { recursive: true });
        await Bun.write(path, png);
        written.set(screen.id, path);
      } catch (err) {
        if (err instanceof Error && err.name === "BrowserMissingError") throw err;
        const msg = err instanceof Error ? err.message : String(err);
        warn(`screenshot of screen "${screen.id}" failed — skipped (${msg.split("\n")[0]})`);
      }
    }
  });
  return written;
}
