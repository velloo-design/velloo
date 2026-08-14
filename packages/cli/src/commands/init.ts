import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "@velloo/schema";
import { writeJsonAtomic, writeText } from "@velloo/server";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { defineCommand } from "citty";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { buildDefaultTheme } from "../scaffold/default-theme.ts";
import {
  buildComponentsScreen,
  buildSampleBoards,
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

    const config = buildDefaultConfig({
      library: {
        id: "shadcn-react",
        version: snapshotVersion,
        // Components are embedded in the Velloo binary; the design folder
        // doesn't ship a `components/` copy. Keeps the repo clean for agents
        // — no risk of two competing `button.tsx` files lying around.
        source: "embedded:shadcn",
        componentsPath: "embedded:shadcn",
      },
      defaultBoard: "welcome",
      defaultScreen: "welcome",
    });

    const theme = buildDefaultTheme();
    const welcome = buildSampleScreen();
    const components = buildComponentsScreen();
    const boards = buildSampleBoards();
    const snippets = buildSampleSnippets();

    ConfigSchema.parse(config);
    ThemeSchema.parse(theme);
    ScreenSchema.parse(welcome);
    ScreenSchema.parse(components);
    for (const board of boards) BoardSchema.parse(board);
    for (const snippet of snippets) SnippetSchema.parse(snippet);

    const configPath = `${folder}/.design/config.json`;
    const themePath = `${folder}/theme/default.json`;
    const cacheKeep = `${folder}/.design/cache/.gitkeep`;
    const assetsKeep = `${folder}/assets/.gitkeep`;

    await Promise.all([
      writeJsonAtomic(configPath, config),
      writeJsonAtomic(themePath, theme),
      writeJsonAtomic(`${folder}/screens/welcome.json`, welcome),
      writeJsonAtomic(`${folder}/screens/components.json`, components),
      ...boards.map((b) => writeJsonAtomic(`${folder}/boards/${b.id}.json`, b)),
      writeText(cacheKeep, ""),
      writeText(assetsKeep, ""),
      ...snippets.map((s) => writeJsonAtomic(`${folder}/snippets/${s.id}.json`, s)),
    ]);

    console.log(`velloo: scaffolded design folder at ${folder}`);
    console.log("  .design/config.json     — tool + library declaration");
    console.log("  theme/default.json      — token tree (colors, type, spacing, radius)");
    console.log("  screens/welcome.json    — responsive welcome screen");
    console.log("  screens/components.json — every primitive in the library");
    console.log(
      `  boards/                 — ${boards.length} starter boards (${boards.map((b) => b.id).join(", ")})`,
    );
    console.log(`  snippets/               — ${snippets.length} starter reusable subtrees`);
    console.log(`  (library)               — shadcn-react@${snapshotVersion} embedded in velloo`);
    console.log("");
    console.log(`Next: velloo run ${args.folder}`);
  },
});
