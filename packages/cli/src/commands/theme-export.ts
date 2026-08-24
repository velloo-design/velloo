import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { colorizeDiff, emitTheme } from "@velloo/codegen";
import { ThemeSchema } from "@velloo/schema";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";
import { resolveDesignFolder } from "../folder.ts";
import { detectHost } from "../scan/detect.ts";

/**
 * Velloo emits Tailwind v4 (`@import "tailwindcss"`, `@theme`, oklch), which
 * won't compile under v3 and whose v4 `tailwind.config.ts` would clobber a v3
 * config. Refuse on a detected v3 target with the detail an agent needs to fix
 * it, rather than writing broken output. `--force-v4` overrides.
 */
function refuseV3(outDir: string, themePath: string): never {
  fail(
    "theme:export",
    [
      `target app at ${outDir} looks like Tailwind v3, but Velloo emits Tailwind v4.`,
      "",
      'The emitted globals.css uses `@import "tailwindcss"`, `@theme`, and oklch() — none',
      "of which compile under v3 — and the v4 tailwind.config.ts would overwrite your v3 config.",
      "",
      "To finish (agent-actionable):",
      `  1. Upgrade the app to Tailwind v4: \`npx @tailwindcss/upgrade\` in ${outDir}, then re-run this command; or`,
      `  2. Hand-port: read the theme tokens at ${themePath}, convert each color to your v3`,
      "     convention (HSL triplets in `:root`/`.dark`), and map them under",
      "     `theme.extend.colors` in tailwind.config.js. Keep your existing `@tailwind` directives.",
      "",
      "Or pass --force-v4 to emit the v4 files anyway.",
    ].join("\n"),
  );
}

export default defineCommand({
  meta: {
    name: "theme:export",
    description: "Export theme as Tailwind v4 globals.css (+ tailwind.config.ts) in diff mode",
  },
  args: {
    to: {
      type: "string",
      required: true,
      description: "Target app directory (writes <to>/app/globals.css and <to>/tailwind.config.ts)",
    },
    folder: {
      type: "string",
      description: "Design folder to read the theme from (default: ./velloo)",
    },
    theme: {
      type: "string",
      description: "Path to theme JSON (default: <folder>/theme/default.json)",
    },
    apply: {
      type: "boolean",
      description: "Write files instead of printing diffs. Default: dry-run.",
    },
    "css-only": {
      type: "boolean",
      description: "Skip tailwind.config.ts (CSS-only export).",
    },
    "force-v4": {
      type: "boolean",
      description: "Emit v4 output even when the target app looks like Tailwind v3.",
    },
  },
  async run({ args }) {
    const themePath = args.theme
      ? resolve(args.theme)
      : join(await resolveDesignFolder(args.folder, "theme:export"), "theme", "default.json");
    const outDir = isAbsolute(args.to) ? args.to : resolve(args.to);

    // Guard against emitting v4 into a v3 app (won't compile, clobbers config).
    if (!args["force-v4"] && detectHost(outDir).tailwindMajor === 3) {
      refuseV3(outDir, themePath);
    }

    const themeJson = JSON.parse(await readFile(themePath, "utf8"));
    const theme = ThemeSchema.parse(themeJson);

    const result = await emitTheme(theme, {
      outputDir: outDir,
      apply: Boolean(args.apply),
      cssOnly: Boolean(args["css-only"]),
    });

    const useColor = stdout.isTTY === true;
    let anyChange = false;

    for (const warning of result.warnings) {
      console.error(`velloo theme:export: warning: ${warning}`);
    }

    for (const file of result.files) {
      if (file.errors.length > 0) {
        // CSS formatter warnings are non-fatal; surface them but keep going.
        for (const e of file.errors) {
          console.error(`velloo theme:export: [${file.path}][${e.stage}] ${e.message}`);
        }
      }
      if (file.diff.identical) {
        console.log(`velloo theme:export: ${file.path} is already up to date.`);
        continue;
      }
      anyChange = true;
      if (file.applied) {
        console.log(`velloo theme:export: wrote ${file.path}`);
      } else {
        const rendered = useColor ? colorizeDiff(file.diff.diff) : file.diff.diff;
        stdout.write(`${rendered}\n`);
        stdout.write(`Would write to: ${file.path}\n\n`);
      }
    }

    if (!anyChange || args.apply) return;

    if (!stdin.isTTY) {
      console.log("(non-TTY) re-run with --apply to write the files.");
      return;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question("Apply all? (y/N) ")).trim().toLowerCase();
    rl.close();
    if (answer === "y" || answer === "yes") {
      const final = await emitTheme(theme, {
        outputDir: outDir,
        apply: true,
        cssOnly: Boolean(args["css-only"]),
      });
      for (const file of final.files) {
        if (file.applied) console.log(`velloo theme:export: wrote ${file.path}`);
      }
    } else {
      console.log("velloo theme:export: skipped (no changes written).");
    }
  },
});
