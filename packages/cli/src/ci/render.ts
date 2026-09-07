import { join } from "node:path";
import type { Config } from "@velloo/schema";
import {
  type DesignFolder,
  extraThemeBlock,
  findHostTailwindConfig,
  loadDesignFolder,
  resolveProviders,
  TailwindJit,
} from "@velloo/server";

/**
 * Loading half of the headless render pipeline `velloo ci` points at an
 * arbitrary design folder — the working tree for 'after', a git-archive temp
 * dir for 'before'.
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
  const config = design.config;
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
