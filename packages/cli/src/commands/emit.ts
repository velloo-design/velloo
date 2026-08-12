import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  colorizeDiff,
  emitCode,
  UnknownComponentError,
  VariantNotFoundError,
} from "@velloo/codegen";
import { PageSchema } from "@velloo/schema";
import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "emit",
    description: "Codegen: emit one page variant as idiomatic shadcn JSX",
  },
  args: {
    page: {
      type: "positional",
      required: true,
      description: "Path to a page JSON file (e.g. design/pages/onboarding.json)",
    },
    variant: {
      type: "string",
      required: true,
      description: "Variant id to emit (matches a variant.id in the page)",
    },
    to: { type: "string", required: true, description: "Output .tsx path" },
    apply: {
      type: "boolean",
      description: "Write the file instead of printing the diff. Default: dry-run.",
    },
    "components-alias": {
      type: "string",
      description: 'Override the import prefix (default "@/components/ui").',
    },
  },
  async run({ args }) {
    const pagePath = resolve(args.page);
    const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);

    const pageJson = JSON.parse(await readFile(pagePath, "utf8"));
    const page = PageSchema.parse(pageJson);

    try {
      const result = await emitCode(page, {
        variantId: args.variant,
        outputPath: outPath,
        componentsAlias: args["components-alias"],
        apply: Boolean(args.apply),
      });

      if (result.errors.length > 0) {
        console.error("velloo emit: generated code failed validation:");
        for (const e of result.errors) console.error(`  [${e.stage}] ${e.message}`);
        process.exit(1);
      }

      if (result.diff.identical) {
        console.log(`velloo emit: ${outPath} is already up to date.`);
        return;
      }

      if (result.applied) {
        console.log(`velloo emit: wrote ${outPath} (variant=${args.variant})`);
        return;
      }

      // Dry-run: print colored diff, then prompt y/N (only if a TTY).
      const useColor = stdout.isTTY === true;
      const rendered = useColor ? colorizeDiff(result.diff.diff) : result.diff.diff;
      stdout.write(`${rendered}\n`);
      stdout.write(`Would write to: ${outPath}\n`);

      if (!stdin.isTTY) {
        console.log("(non-TTY) re-run with --apply to write the file.");
        return;
      }
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = (await rl.question("Apply? (y/N) ")).trim().toLowerCase();
      rl.close();
      if (answer === "y" || answer === "yes") {
        const final = await emitCode(page, {
          variantId: args.variant,
          outputPath: outPath,
          componentsAlias: args["components-alias"],
          apply: true,
        });
        if (final.applied) console.log(`velloo emit: wrote ${outPath}`);
      } else {
        console.log("velloo emit: skipped (no changes written).");
      }
    } catch (err) {
      if (err instanceof VariantNotFoundError || err instanceof UnknownComponentError) {
        console.error(`velloo emit: ${err.message}`);
        const ids = page.variants.map((v) => v.id).join(", ");
        if (err instanceof VariantNotFoundError) {
          console.error(`  Available variants: ${ids}`);
        }
        process.exit(1);
      }
      throw err;
    }
  },
});
