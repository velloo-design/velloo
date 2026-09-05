import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ComponentProvider } from "@velloo/provider";
import type { Board, Config, Library, Screen, Snippet, Theme } from "@velloo/schema";
import { CURRENT_SCHEMA_VERSION } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import type { MutationContext } from "../mutations/index.ts";
import type { WatchEvent } from "../watcher.ts";

/**
 * Scaffolding for tests that need a real design folder on disk.
 *
 * Before this, ~50 test files carried their own copy of the same config and
 * theme literal and their own `mkdir`/`writeJson`/`loadDesignFolder` chain, so
 * every schema change rippled through fifty near-identical blocks and each
 * copy drifted a little. The defaults here are the shape those copies
 * converged on; everything a caller actually varies is an override.
 *
 * Exported from `@velloo/server/testing` so the CLI's tests can use it too.
 * Test-only — nothing in the runtime imports this.
 */

/** The default library entry: the embedded shadcn snapshot, no host app. */
const DEFAULT_LIBRARY: Library = {
  id: "shadcn-upstream",
  version: "test",
  source: "binary",
  componentsPath: "binary",
};

export interface DesignConfigOverrides extends Partial<Omit<Config, "libraries">> {
  /** Merged into `libraries.default` — the common case is one field. */
  library?: Partial<Library>;
  /** Replaces the whole map, for multi-library folders. */
  libraries?: Config["libraries"];
}

export function designConfig(overrides: DesignConfigOverrides = {}): Config {
  const { library, libraries, ...rest } = overrides;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    toolVersion: "0.1.0",
    libraries: libraries ?? { default: { ...DEFAULT_LIBRARY, ...library } },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    ...rest,
  } as Config;
}

/**
 * The smallest theme the schema accepts, in oklch because that is what a real
 * folder carries. Deliberately no `border`/`ring`: emitted CSS is asserted on
 * in several suites, so the default stays exactly what those tests were
 * already writing. Tests that need more slots pass `colors`.
 */
export function designTheme(
  overrides: Omit<Partial<Theme>, "colors"> & { colors?: Partial<Theme["colors"]> } = {},
): Theme {
  // `colors` is pulled out so `...rest` can't put the caller's partial back
  // over the merged one — overriding `primary` must not drop `background`.
  const { colors, ...rest } = overrides;
  return {
    name: "default",
    colors: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
      ...colors,
    },
    typography: {},
    spacing: {},
    radius: {},
    ...rest,
  } as Theme;
}

/** A one-node screen — enough to render, cheap enough to ignore. */
export function designScreen(id: string, overrides: Partial<Screen> = {}): Screen {
  return {
    id,
    name: id.replace(
      /(^|-)(\w)/g,
      (_, sep: string, ch: string) => (sep ? " " : "") + ch.toUpperCase(),
    ),
    tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
    ...overrides,
  } as Screen;
}

/** A board with one frame per screen id, laid out left to right. */
export function designBoard(
  id: string,
  screenIds: string[],
  overrides: Partial<Board> = {},
): Board {
  return {
    id,
    name: id,
    frames: screenIds.map((screen, i) => ({
      id: `frame-${screen}`,
      screen,
      x: i * 1600,
      y: 0,
      viewport: { w: 1440, h: 900 },
    })),
    ...overrides,
  } as Board;
}

export interface ScaffoldOptions {
  /** Config overrides, or a complete config to write verbatim. */
  config?: DesignConfigOverrides | Config;
  /** The default theme (`theme/default.json`). */
  theme?: Partial<Theme>;
  /** Extra named themes, keyed by filename stem. */
  themes?: Record<string, Theme>;
  /** Screens by id — pass `true` for the default one-node screen. */
  screens?: Record<string, Screen | true>;
  boards?: Record<string, Board>;
  snippets?: Record<string, Snippet>;
  /** `theme/custom.css`, when a test needs the escape hatch. */
  customCss?: string;
  /** Any other file, path relative to the folder root; objects are JSON. */
  files?: Record<string, string | object>;
  /** Prefix for the temp directory name, to make a stray one identifiable. */
  label?: string;
}

export interface ScaffoldedFolder {
  /** Absolute path to the design folder. */
  root: string;
  /** Write another file after the fact, relative to `root`. */
  write(relativePath: string, contents: string | object): Promise<void>;
  cleanup(): Promise<void>;
}

async function writeAny(path: string, value: string | object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, body, "utf8");
}

const isCompleteConfig = (c: DesignConfigOverrides | Config): c is Config =>
  "schemaVersion" in c && "defaultLibrary" in c && "libraries" in c;

/** Write a design folder into a fresh temp directory. */
export async function scaffoldDesignFolder(
  options: ScaffoldOptions = {},
): Promise<ScaffoldedFolder> {
  const label = options.label ?? "folder";
  const root = join(
    tmpdir(),
    `velloo-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  for (const dir of [".design", "theme", "screens", "boards", "snippets"]) {
    await mkdir(join(root, dir), { recursive: true });
  }

  const config =
    options.config && isCompleteConfig(options.config)
      ? options.config
      : designConfig(options.config ?? {});
  await writeAny(join(root, ".design/config.json"), config);
  await writeAny(join(root, "theme/default.json"), designTheme(options.theme ?? {}));
  for (const [name, theme] of Object.entries(options.themes ?? {})) {
    await writeAny(join(root, "theme", `${name}.json`), theme);
  }
  if (options.customCss !== undefined) {
    await writeAny(join(root, "theme/custom.css"), options.customCss);
  }
  for (const [id, screen] of Object.entries(options.screens ?? {})) {
    await writeAny(
      join(root, "screens", `${id}.json`),
      screen === true ? designScreen(id) : screen,
    );
  }
  for (const [id, board] of Object.entries(options.boards ?? {})) {
    await writeAny(join(root, "boards", `${id}.json`), board);
  }
  for (const [id, snippet] of Object.entries(options.snippets ?? {})) {
    await writeAny(join(root, "snippets", `${id}.json`), snippet);
  }
  for (const [rel, contents] of Object.entries(options.files ?? {})) {
    await writeAny(join(root, rel), contents);
  }

  return {
    root,
    write: (rel, contents) => writeAny(join(root, rel), contents),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface TestContext extends ScaffoldedFolder {
  folder: DesignFolder;
  ctx: MutationContext;
  /** Everything `ctx.broadcast` was handed, in order. */
  events: (WatchEvent | ActivityEvent)[];
  /** Re-read the folder from disk into the same ctx, as the watcher does. */
  reload(): Promise<DesignFolder>;
}

export interface TestContextOptions extends ScaffoldOptions {
  /** Defaults to the embedded shadcn snapshot. */
  provider?: ComponentProvider;
  /** Extra providers by library id, for multi-library folders. */
  providers?: Record<string, ComponentProvider>;
}

/** Scaffold a folder, load it, and wrap it in a MutationContext that records broadcasts. */
export async function testContext(options: TestContextOptions = {}): Promise<TestContext> {
  const { provider, providers, ...scaffold } = options;
  const defaultProvider = provider ?? createShadcnProvider();
  const folderFiles = await scaffoldDesignFolder(scaffold);
  const folder = await loadDesignFolder(folderFiles.root);
  const events: (WatchEvent | ActivityEvent)[] = [];
  const ctx: MutationContext = {
    folder,
    providers: { default: defaultProvider, ...providers },
    defaultProvider,
    broadcast: (e) => {
      events.push(e);
    },
  };
  return {
    ...folderFiles,
    folder,
    ctx,
    events,
    async reload() {
      const next = await loadDesignFolder(folderFiles.root);
      ctx.folder = next;
      return next;
    },
  };
}
