import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { colorizeDiff, type EmitCodeResult, emitCode } from "@velloo/codegen";
import { type Page, PageSchema, type Variant } from "@velloo/schema";
import { defineCommand } from "citty";
import { findDesignConfig } from "../design-config.ts";

export default defineCommand({
  meta: {
    name: "emit",
    description: "Codegen: emit one or more page variants as idiomatic shadcn JSX",
  },
  args: {
    page: {
      type: "positional",
      required: true,
      description: "Path to a page JSON file (e.g. design/pages/onboarding.json)",
    },
    variant: {
      type: "string",
      description: "Single variant id to emit. Mutually exclusive with --variants/--all.",
    },
    variants: {
      type: "string",
      description: "Comma-separated variant ids to emit (requires {variant} in --to).",
    },
    all: {
      type: "boolean",
      description: "Emit every variant in the page (requires {variant} in --to).",
    },
    to: {
      type: "string",
      required: true,
      description:
        "Output .tsx path. For multi-variant emit, include the literal {variant} placeholder.",
    },
    apply: {
      type: "boolean",
      description: "Write the file instead of printing the diff. Default: dry-run.",
    },
    "components-alias": {
      type: "string",
      description:
        'Override the import prefix. Defaults to .design/config.json#codegen.componentsAlias, else "@/components/ui".',
    },
  },
  async run({ args }) {
    const pagePath = resolve(args.page);
    const pageJson = JSON.parse(await readFile(pagePath, "utf8"));
    const page = PageSchema.parse(pageJson);

    const targets = pickVariants(page, args);
    if (targets.length > 1 && !args.to.includes("{variant}")) {
      console.error(
        "velloo emit: multi-variant emit requires {variant} in --to (e.g. ./app/{variant}/page.tsx).",
      );
      process.exit(1);
    }

    const componentsAlias = args["components-alias"] ?? (await readConfigAlias(pagePath));

    let pendingDryRun = false;
    const dryRunResults: { variant: Variant; outPath: string; result: EmitCodeResult }[] = [];

    for (const variant of targets) {
      const outPath = resolveOutputPath(args.to, variant.id);
      const result = await runEmit(page, variant, outPath, componentsAlias, Boolean(args.apply));
      if (!result) process.exit(1);

      if (result.errors.length > 0) {
        console.error(`velloo emit: ${outPath} failed validation:`);
        for (const e of result.errors) console.error(`  [${e.stage}] ${e.message}`);
        process.exit(1);
      }

      if (result.diff.identical) {
        console.log(`velloo emit: ${outPath} is already up to date.`);
        continue;
      }
      if (result.applied) {
        console.log(`velloo emit: wrote ${outPath} (variant=${variant.id})`);
        continue;
      }

      // Dry-run path — collect, render diffs after the loop.
      pendingDryRun = true;
      dryRunResults.push({ variant, outPath, result });
    }

    if (!pendingDryRun) return;

    const useColor = stdout.isTTY === true;
    for (const { outPath, result } of dryRunResults) {
      const rendered = useColor ? colorizeDiff(result.diff.diff) : result.diff.diff;
      stdout.write(`${rendered}\n`);
      stdout.write(`Would write to: ${outPath}\n\n`);
    }

    if (!stdin.isTTY) {
      console.log("(non-TTY) re-run with --apply to write.");
      return;
    }

    const label = dryRunResults.length === 1 ? "Apply? (y/N) " : "Apply all? (y/N) ";
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question(label)).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("velloo emit: skipped (no changes written).");
      return;
    }
    for (const { variant, outPath } of dryRunResults) {
      const final = await runEmit(page, variant, outPath, componentsAlias, true);
      if (final?.applied) console.log(`velloo emit: wrote ${outPath}`);
    }
  },
});

function pickVariants(
  page: Page,
  args: { variant?: string; variants?: string; all?: boolean },
): Variant[] {
  const selectors = [args.variant, args.variants, args.all].filter((v) => v != null && v !== false);
  if (selectors.length === 0) {
    console.error("velloo emit: pass --variant <id>, --variants <a,b>, or --all.");
    console.error(`  Available variants: ${page.variants.map((v) => v.id).join(", ")}`);
    process.exit(1);
  }
  if (selectors.length > 1) {
    console.error("velloo emit: --variant, --variants, and --all are mutually exclusive.");
    process.exit(1);
  }

  if (args.all) return [...page.variants];

  const ids = args.variants
    ? args.variants
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [args.variant as string];
  const picked: Variant[] = [];
  for (const id of ids) {
    const v = page.variants.find((x) => x.id === id);
    if (!v) {
      console.error(`velloo emit: variant ${JSON.stringify(id)} not found.`);
      console.error(`  Available: ${page.variants.map((x) => x.id).join(", ")}`);
      process.exit(1);
    }
    picked.push(v);
  }
  return picked;
}

function resolveOutputPath(template: string, variantId: string): string {
  const filled = template.replaceAll("{variant}", variantId);
  return isAbsolute(filled) ? filled : resolve(filled);
}

async function readConfigAlias(pagePath: string): Promise<string | undefined> {
  const found = await findDesignConfig(pagePath);
  return found?.config.codegen?.componentsAlias;
}

async function runEmit(
  page: Page,
  variant: Variant,
  outPath: string,
  componentsAlias: string | undefined,
  apply: boolean,
): Promise<EmitCodeResult | null> {
  const result = await emitCode(page, {
    variantId: variant.id,
    outputPath: outPath,
    componentsAlias,
    apply,
  });
  if (result.ok) return result.value;
  if (result.error.kind === "VariantNotFound") {
    console.error(`velloo emit: variant not found: ${JSON.stringify(result.error.variantId)}`);
  } else if (result.error.kind === "UnknownComponent") {
    console.error(`velloo emit: unknown component: ${JSON.stringify(result.error.ref)}`);
  }
  return null;
}
