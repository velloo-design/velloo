import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigSchema, PageSchema, ThemeSchema } from "@velloo/schema";
import { defineCommand } from "citty";
import { writeJsonAtomic, writeText } from "../fs.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { buildDefaultTheme } from "../scaffold/default-theme.ts";
import { buildSamplePage } from "../scaffold/sample-page.ts";

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
    const page = buildSamplePage();

    // Validate before writing — defense in depth.
    ConfigSchema.parse(config);
    ThemeSchema.parse(theme);
    PageSchema.parse(page);

    const configPath = `${folder}/.design/config.json`;
    const themePath = `${folder}/theme/default.json`;
    const pagePath = `${folder}/pages/onboarding.json`;
    const cacheKeep = `${folder}/.design/cache/.gitkeep`;
    const assetsKeep = `${folder}/assets/.gitkeep`;

    await Promise.all([
      writeJsonAtomic(configPath, config),
      writeJsonAtomic(themePath, theme),
      writeJsonAtomic(pagePath, page),
      writeText(cacheKeep, ""),
      writeText(assetsKeep, ""),
    ]);

    console.log(`velloo: scaffolded design folder at ${folder}`);
    console.log("  .design/config.json    — locked tool + shadcn snapshot");
    console.log("  theme/default.json     — token tree (colors, type, spacing, radius)");
    console.log("  pages/onboarding.json  — sample page with mobile + desktop variants");
    console.log("");
    console.log("Next: `velloo run <folder>` (available once Sprint 3 lands).");
  },
});
