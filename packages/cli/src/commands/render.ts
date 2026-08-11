import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { renderVariant, screenshot } from "@velloo/renderer";
import { PageSchema, ThemeSchema } from "@velloo/schema";
import { defineCommand } from "citty";
import { writeText } from "../fs.ts";

export default defineCommand({
  meta: {
    name: "render",
    description: "dev: render a variant headless to .html or .png",
  },
  args: {
    page: {
      type: "positional",
      required: true,
      description: "Path to a page JSON file (e.g. design/pages/onboarding.json)",
    },
    variant: {
      type: "string",
      description: "Variant id to render (default: first)",
    },
    to: {
      type: "string",
      required: true,
      description: "Output path. Extension drives format: .html | .png",
    },
  },
  async run({ args }) {
    const pagePath = resolve(args.page);
    const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);

    // Layout assumption: <folder>/pages/<page>.json, <folder>/theme/default.json
    const folder = dirname(dirname(pagePath));
    const themePath = resolve(folder, "theme", "default.json");

    const [pageJson, themeJson] = await Promise.all([
      readFile(pagePath, "utf8").then(JSON.parse),
      readFile(themePath, "utf8").then(JSON.parse),
    ]);
    const page = PageSchema.parse(pageJson);
    const theme = ThemeSchema.parse(themeJson);

    const variant = args.variant
      ? page.variants.find((v) => v.id === args.variant)
      : page.variants[0];
    if (!variant) {
      console.error(
        `velloo render: variant ${JSON.stringify(args.variant)} not found in ${pagePath}.\n` +
          `  Available: ${page.variants.map((v) => v.id).join(", ")}`,
      );
      process.exit(1);
    }

    const { html } = await renderVariant(variant, theme);
    const ext = extname(outPath).toLowerCase();

    if (ext === ".html") {
      await writeText(outPath, html);
      console.log(`velloo render: wrote ${outPath} (variant=${variant.id})`);
      return;
    }

    if (ext === ".png") {
      await screenshot({ html, viewport: variant.viewport, outPath });
      console.log(`velloo render: wrote ${outPath} (variant=${variant.id})`);
      return;
    }

    console.error(
      `velloo render: unsupported output extension ${JSON.stringify(ext)}. Use .html or .png.`,
    );
    process.exit(1);
  },
});
