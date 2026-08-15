import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { renderScreen, screenshot } from "@velloo/renderer";
import { ConfigSchema, ScreenSchema, ThemeSchema, type Viewport } from "@velloo/schema";
import { migrateConfig, resolveProviders, TailwindJit, writeText } from "@velloo/server";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "render",
    description: "dev: render a screen headless to .html or .png",
  },
  args: {
    screen: {
      type: "positional",
      required: true,
      description: "Path to a screen JSON file (e.g. design/screens/welcome.json)",
    },
    w: {
      type: "string",
      description: "Viewport width in px (default: 1440)",
    },
    h: {
      type: "string",
      description: "Viewport height in px (default: 900)",
    },
    to: {
      type: "string",
      required: true,
      description: "Output path. Extension drives format: .html | .png",
    },
  },
  async run({ args }) {
    const screenPath = resolve(args.screen);
    const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);

    // Layout assumption: <folder>/screens/<screen>.json, <folder>/theme/default.json
    const folder = dirname(dirname(screenPath));
    const themePath = resolve(folder, "theme", "default.json");
    const configPath = resolve(folder, ".design", "config.json");

    const [screenJson, themeJson, configJson] = await Promise.all([
      readFile(screenPath, "utf8").then(JSON.parse),
      readFile(themePath, "utf8").then(JSON.parse),
      readFile(configPath, "utf8").then(JSON.parse),
    ]);
    const screen = ScreenSchema.parse(screenJson);
    const theme = ThemeSchema.parse(themeJson);
    const config = migrateConfig(ConfigSchema.parse(configJson));

    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    const { providers, defaultProvider } = await resolveProviders(config, folder);
    const screenProvider = screen.library
      ? (providers[screen.library] ?? defaultProvider)
      : defaultProvider;
    const jit = new TailwindJit(Object.values(providers), join(folder, "screens"));
    const snapshotCss = await jit.build();
    const { html } = await renderScreen(screen, theme, {
      viewport,
      snapshotCss,
      registry: screenProvider.registry,
    });
    const ext = extname(outPath).toLowerCase();

    if (ext === ".html") {
      await writeText(outPath, html);
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    if (ext === ".png") {
      await screenshot({ html, viewport, outPath });
      console.log(`velloo render: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    fail("render", `unsupported output extension ${JSON.stringify(ext)}. Use .html or .png.`);
  },
});
