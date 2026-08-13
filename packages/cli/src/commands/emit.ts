import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { colorizeDiff, type EmitCodeResult, emitCode } from "@velloo/codegen";
import { type Screen, ScreenSchema } from "@velloo/schema";
import { defineCommand } from "citty";
import { findDesignConfig } from "../design-config.ts";

export default defineCommand({
  meta: {
    name: "emit",
    description: "Codegen: emit a screen as JSX-shaped IR for the agent",
  },
  args: {
    screen: {
      type: "positional",
      required: true,
      description: "Path to a screen JSON file (e.g. design/screens/welcome.json)",
    },
    to: {
      type: "string",
      required: true,
      description: "Output .tsx path.",
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
    const screenPath = resolve(args.screen);
    const screenJson = JSON.parse(await readFile(screenPath, "utf8"));
    const screen = ScreenSchema.parse(screenJson);

    const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);
    const componentsAlias = args["components-alias"] ?? (await readConfigAlias(screenPath));

    const result = await runEmit(screen, outPath, componentsAlias, Boolean(args.apply));
    if (!result) process.exit(1);

    if (result.errors.length > 0) {
      console.error(`velloo emit: ${outPath} failed validation:`);
      for (const e of result.errors) console.error(`  [${e.stage}] ${e.message}`);
      process.exit(1);
    }

    if (result.diff.identical) {
      console.log(`velloo emit: ${outPath} is already up to date.`);
      return;
    }
    if (result.applied) {
      console.log(`velloo emit: wrote ${outPath} (screen=${screen.id})`);
      return;
    }

    const useColor = stdout.isTTY === true;
    const rendered = useColor ? colorizeDiff(result.diff.diff) : result.diff.diff;
    stdout.write(`${rendered}\n`);
    stdout.write(`Would write to: ${outPath}\n\n`);

    if (!stdin.isTTY) {
      console.log("(non-TTY) re-run with --apply to write.");
      return;
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question("Apply? (y/N) ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("velloo emit: skipped (no changes written).");
      return;
    }
    const final = await runEmit(screen, outPath, componentsAlias, true);
    if (final?.applied) console.log(`velloo emit: wrote ${outPath}`);
  },
});

async function readConfigAlias(screenPath: string): Promise<string | undefined> {
  const found = await findDesignConfig(screenPath);
  return found?.config.codegen?.componentsAlias;
}

async function runEmit(
  screen: Screen,
  outPath: string,
  componentsAlias: string | undefined,
  apply: boolean,
): Promise<EmitCodeResult | null> {
  const result = await emitCode(screen, {
    outputPath: outPath,
    componentsAlias,
    apply,
  });
  if (result.ok) return result.value;
  if (result.error.kind === "ScreenNotFound") {
    console.error(`velloo emit: screen not found: ${JSON.stringify(result.error.screenId)}`);
  } else if (result.error.kind === "UnknownComponent") {
    console.error(`velloo emit: unknown component: ${JSON.stringify(result.error.ref)}`);
  }
  return null;
}
