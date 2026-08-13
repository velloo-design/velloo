import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdout } from "node:process";
import { emitCode } from "@velloo/codegen";
import { ScreenSchema } from "@velloo/schema";
import { defineCommand } from "citty";
import { findDesignConfig } from "../design-config.ts";

export default defineCommand({
  meta: {
    name: "emit",
    description: "Print or write agent-consumed IR for a screen.",
  },
  args: {
    screen: {
      type: "positional",
      required: true,
      description: "Path to a screen JSON file (e.g. design/screens/welcome.json)",
    },
    to: {
      type: "string",
      description:
        "Write IR as JSON to this path. Omit to print the JSX body to stdout (agent-friendly when piped).",
    },
    "components-alias": {
      type: "string",
      description:
        'Override the import prefix the IR mentions in snippet identifiers. Defaults to .design/config.json#codegen.componentsAlias, else "@/components/ui".',
    },
  },
  async run({ args }) {
    const screenPath = resolve(args.screen);
    const screenJson = JSON.parse(await readFile(screenPath, "utf8"));
    const screen = ScreenSchema.parse(screenJson);

    const componentsAlias = args["components-alias"] ?? (await readConfigAlias(screenPath));

    const result = await emitCode(screen, {
      ...(componentsAlias ? { componentsAlias } : {}),
    });
    if (!result.ok) {
      if (result.error.kind === "UnknownComponent") {
        console.error(`velloo emit: unknown component: ${JSON.stringify(result.error.ref)}`);
      } else if (result.error.kind === "SnippetNotFound") {
        console.error(`velloo emit: snippet not found: ${JSON.stringify(result.error.snippetId)}`);
      } else if (result.error.kind === "ScreenNotFound") {
        console.error(`velloo emit: screen not found: ${JSON.stringify(result.error.screenId)}`);
      }
      process.exit(1);
    }

    if (args.to) {
      const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);
      await writeFile(outPath, JSON.stringify(result.value, null, 2), "utf8");
      console.log(`velloo emit: wrote ${outPath}`);
      return;
    }

    stdout.write(`// screen: ${result.value.screen.id} (${result.value.screen.name})\n`);
    stdout.write(`// components: ${result.value.componentsUsed.join(", ") || "(none)"}\n`);
    if (result.value.iconsUsed.length > 0) {
      stdout.write(`// icons (lucide): ${result.value.iconsUsed.join(", ")}\n`);
    }
    if (result.value.snippetsUsed.length > 0) {
      stdout.write(
        `// snippets: ${result.value.snippetsUsed.map((s) => `${s.componentName}(${s.id})`).join(", ")}\n`,
      );
    }
    stdout.write("\n");
    stdout.write(`${result.value.jsx}\n`);
  },
});

async function readConfigAlias(screenPath: string): Promise<string | undefined> {
  const found = await findDesignConfig(screenPath);
  return found?.config.codegen?.componentsAlias;
}
