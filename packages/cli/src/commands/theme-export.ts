import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { colorizeDiff, emitTheme } from "@velloo/codegen";
import { ThemeSchema } from "@velloo/schema";
import { defineCommand } from "citty";

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
    theme: {
      type: "string",
      description: "Path to theme JSON (default: ./theme/default.json under cwd)",
    },
    apply: {
      type: "boolean",
      description: "Write files instead of printing diffs. Default: dry-run.",
    },
    "css-only": {
      type: "boolean",
      description: "Skip tailwind.config.ts (CSS-only export).",
    },
  },
  async run({ args }) {
    const themePath = args.theme ? resolve(args.theme) : resolve("theme", "default.json");
    const outDir = isAbsolute(args.to) ? args.to : resolve(args.to);

    const themeJson = JSON.parse(await readFile(themePath, "utf8"));
    const theme = ThemeSchema.parse(themeJson);

    const result = await emitTheme(theme, {
      outputDir: outDir,
      apply: Boolean(args.apply),
      cssOnly: Boolean(args["css-only"]),
    });

    const useColor = stdout.isTTY === true;
    let anyChange = false;

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
