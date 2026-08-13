import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "@velloo/schema";
import {
  buildAndWriteManifest,
  loadLucideNames,
  writeJsonAtomic,
  writeText,
} from "@velloo/server";
import { defineCommand } from "citty";
import { getLibrary, pullLibraryIntoFolder } from "../library-registry.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { buildDefaultTheme } from "../scaffold/default-theme.ts";
import {
  buildComponentsScreen,
  buildSampleBoard,
  buildSampleScreen,
} from "../scaffold/sample-page.ts";
import { buildSampleSnippets } from "../scaffold/sample-snippets.ts";

async function isEmptyOrMissing(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a new Velloo design folder",
  },
  args: {
    folder: {
      type: "positional",
      required: true,
      description: "Target folder for the new design (created if missing)",
    },
    library: {
      type: "string",
      default: "shadcn-react",
      description:
        "Library to pull into the design folder. Only shadcn-react is supported today.",
    },
    "experimental-shared": {
      type: "string",
      description:
        "Experimental: point the design folder at the user's app components instead of pulling a fresh copy. Pass the path to <app>/components (relative or absolute). Failure modes are surfaced verbosely; treat this as a power-user flag.",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Allow scaffolding into a non-empty folder",
    },
  },
  async run({ args }) {
    const folder = resolve(args.folder);

    if (!args.force && !(await isEmptyOrMissing(folder))) {
      console.error(
        `velloo init: target folder is not empty: ${folder}\n` +
          `  Pick an empty path, or pass --force to scaffold over it.`,
      );
      process.exit(1);
    }

    let library;
    try {
      library = getLibrary(args.library);
    } catch (err) {
      console.error(`velloo init: ${(err as Error).message}`);
      process.exit(1);
    }

    const experimentalShared = args["experimental-shared"];
    const componentsPath = experimentalShared ?? "components";
    const config = buildDefaultConfig({
      library: {
        id: library.id,
        version: library.version,
        source: experimentalShared ? `shared:${experimentalShared}` : "registry:shadcn",
        componentsPath,
        ...(experimentalShared ? { experimental: "shared" as const } : {}),
      },
    });

    const theme = buildDefaultTheme();
    const welcome = buildSampleScreen();
    const components = buildComponentsScreen();
    const board = buildSampleBoard();
    const snippets = buildSampleSnippets();

    ConfigSchema.parse(config);
    ThemeSchema.parse(theme);
    ScreenSchema.parse(welcome);
    ScreenSchema.parse(components);
    BoardSchema.parse(board);
    for (const snippet of snippets) SnippetSchema.parse(snippet);

    const configPath = `${folder}/.design/config.json`;
    const themePath = `${folder}/theme/default.json`;
    const welcomePath = `${folder}/screens/welcome.json`;
    const componentsScreenPath = `${folder}/screens/components.json`;
    const boardPath = `${folder}/board.json`;
    const cacheKeep = `${folder}/.design/cache/.gitkeep`;
    const assetsKeep = `${folder}/assets/.gitkeep`;

    await Promise.all([
      writeJsonAtomic(configPath, config),
      writeJsonAtomic(themePath, theme),
      writeJsonAtomic(welcomePath, welcome),
      writeJsonAtomic(componentsScreenPath, components),
      writeJsonAtomic(boardPath, board),
      writeText(cacheKeep, ""),
      writeText(assetsKeep, ""),
      ...snippets.map((s) => writeJsonAtomic(`${folder}/snippets/${s.id}.json`, s)),
    ]);

    let libraryFiles = 0;
    if (!experimentalShared) {
      const r = await pullLibraryIntoFolder(library, folder, "components");
      libraryFiles = r.filesCopied;
    }

    const componentsRoot = `${folder}/${componentsPath}`;
    const lucideNames = await loadLucideNames();
    const manifest = await buildAndWriteManifest({
      componentsRoot,
      outPath: `${folder}/.design/manifest.json`,
      ...(lucideNames ? { lucideNames } : {}),
    });

    console.log(`velloo: scaffolded design folder at ${folder}`);
    console.log("  .design/config.json     — tool + library declaration");
    console.log("  theme/default.json      — token tree (colors, type, spacing, radius)");
    console.log("  screens/welcome.json    — responsive welcome screen");
    console.log("  screens/components.json — every primitive in the library");
    console.log("  board.json              — canvas layout (frames + groups)");
    console.log(`  snippets/               — ${snippets.length} starter reusable subtrees`);
    if (experimentalShared) {
      console.log(`  (experimental) library  — pointing at ${experimentalShared}`);
    } else {
      console.log(
        `  components/             — ${libraryFiles} files from ${library.label}@${library.version}`,
      );
    }
    console.log(
      `  .design/manifest.json   — ${manifest.length} components extracted via ts-morph`,
    );
    console.log("");
    console.log(`Next: velloo run ${args.folder}`);
  },
});
