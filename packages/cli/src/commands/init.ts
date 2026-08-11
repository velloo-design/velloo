import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigSchema, PageSchema, ThemeSchema } from "@velloo/schema";
import { writeJsonAtomic, writeText } from "@velloo/server";
import { defineCommand } from "citty";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { buildDefaultTheme } from "../scaffold/default-theme.ts";
import { buildSamplePage, buildSettingsPage } from "../scaffold/sample-page.ts";

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

    const config = buildDefaultConfig();
    const theme = buildDefaultTheme();
    const welcome = buildSamplePage();
    const settings = buildSettingsPage();

    // Validate before writing — defense in depth.
    ConfigSchema.parse(config);
    ThemeSchema.parse(theme);
    PageSchema.parse(welcome);
    PageSchema.parse(settings);

    const configPath = `${folder}/.design/config.json`;
    const themePath = `${folder}/theme/default.json`;
    const welcomePath = `${folder}/pages/welcome.json`;
    const settingsPath = `${folder}/pages/settings.json`;
    const cacheKeep = `${folder}/.design/cache/.gitkeep`;
    const assetsKeep = `${folder}/assets/.gitkeep`;

    await Promise.all([
      writeJsonAtomic(configPath, config),
      writeJsonAtomic(themePath, theme),
      writeJsonAtomic(welcomePath, welcome),
      writeJsonAtomic(settingsPath, settings),
      writeText(cacheKeep, ""),
      writeText(assetsKeep, ""),
    ]);

    console.log(`velloo: scaffolded design folder at ${folder}`);
    console.log("  .design/config.json    — locked tool + shadcn snapshot");
    console.log("  theme/default.json     — token tree (colors, type, spacing, radius)");
    console.log("  pages/welcome.json     — Velloo onboarding (mobile + desktop)");
    console.log("  pages/settings.json    — profile / account / notifications");
    console.log("");
    console.log(`Next: velloo run ${args.folder}`);
  },
});
