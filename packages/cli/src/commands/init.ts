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
import { buildSampleBoards, buildSampleScreens } from "../scaffold/sample-page.ts";
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
      // No defaultBoard: let the canvas pick the alphabetically-first
      // one ("app" in Pulse). "Marketing" was a personal preference and
      // confused first-time users who expected the top-of-list to win.
      defaultScreen: "landing",
    });

    const theme = buildDefaultTheme();
    const screens = buildSampleScreens();
    const boards = buildSampleBoards();
    const snippets = buildSampleSnippets();

    ConfigSchema.parse(config);
    ThemeSchema.parse(theme);
    for (const screen of screens) ScreenSchema.parse(screen);
    for (const board of boards) BoardSchema.parse(board);
    for (const snippet of snippets) SnippetSchema.parse(snippet);

    const configPath = `${folder}/.design/config.json`;
    const themePath = `${folder}/theme/default.json`;
    const cacheKeep = `${folder}/.design/cache/.gitkeep`;
    const assetsKeep = `${folder}/assets/.gitkeep`;

    await Promise.all([
      writeJsonAtomic(configPath, config),
      writeJsonAtomic(themePath, theme),
      ...screens.map((s) => writeJsonAtomic(`${folder}/screens/${s.id}.json`, s)),
      ...boards.map((b) => writeJsonAtomic(`${folder}/boards/${b.id}.json`, b)),
      ...snippets.map((s) => writeJsonAtomic(`${folder}/snippets/${s.id}.json`, s)),
      writeText(cacheKeep, ""),
      writeText(assetsKeep, ""),
    ]);

    const boardLabels = boards.map((b) => b.name).join(" + ");
    const screenCount = screens.length;

    console.log(`velloo: scaffolded ${args.folder}`);
    console.log("");
    console.log(
      `  📋 ${boardLabels} — ${screenCount} screens across ${boards.length} board${boards.length === 1 ? "" : "s"}`,
    );
    console.log(`     Pulse — a sample team-analytics product, ready to remix.`);
    console.log("");
    console.log("  .design/config.json     tool + library declaration");
    console.log("  theme/default.json      indigo accent, dark-mode coherent");
    console.log(
      `  screens/                ${screenCount} screens (${screens.map((s) => s.id).join(", ")})`,
    );
    console.log(
      `  boards/                 ${boards.length} boards (${boards.map((b) => b.id).join(", ")})`,
    );
    console.log(`  snippets/               ${snippets.length} reusable subtrees`);
    console.log(`  (library)               shadcn-react@${snapshotVersion} embedded in velloo`);
    console.log("");
    console.log(`▶ velloo run ${args.folder}    open the canvas`);
    console.log("");
    console.log("Tip: in your AI agent, ask “implement the landing screen in my app”");
    console.log("     once Velloo MCP is connected. The agent reads the design and writes");
    console.log("     real .tsx into your app in your conventions.");
  },
});
