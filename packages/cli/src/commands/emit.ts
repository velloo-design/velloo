import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { stdout } from "node:process";
import {
  type CodegenTarget,
  classNamesInJsx,
  detectTailwindMajor,
  emitCode,
  moduleTarget,
  v3ClassIssues,
} from "@velloo/codegen";
import { type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import { type Screen, ScreenSchema } from "@velloo/schema";
import { hostAppRootFrom, loadDesignFolder, resolveProviders } from "@velloo/server";
import { defineCommand } from "citty";
import { findDesignConfig } from "../design-config.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, pickScreen, resolveDesignFolder } from "../folder.ts";
import { createProgress } from "../progress.ts";

/**
 * Load the emit context a screen needs from its containing design folder:
 * snippets (so `@id` snippet refs resolve), extensions (so extension `$ref`s
 * resolve), and the framework target / inline-style flag (so a MUI or
 * none/none folder emits its native idiom instead of shadcn-Tailwind lowering).
 * Mirrors the MCP `emit_code` tool. Returns {} when the screen isn't inside a
 * folder (a bare external path) — emit still works, just without folder context.
 */
async function folderEmitContext(
  screenPath: string,
  screen: Screen,
): Promise<Partial<Parameters<typeof emitCode>[1]>> {
  const found = await findDesignConfig(screenPath);
  if (!found) return {};
  const design = await loadDesignFolder(found.folder);
  const { providers, defaultProvider } = await resolveProviders(design.config, found.folder);
  const provider = (screen.library && providers[screen.library]) || defaultProvider;
  const adapter = provider as FrameworkAdapter;
  let target: CodegenTarget | undefined;
  if (adapter.codegenModule) {
    const manifest = await provider.loadManifest();
    target = moduleTarget(
      manifest.filter((c) => c.source !== "velloo").map((c) => c.id),
      adapter.codegenModule,
    );
  }
  const inlineStyle = styleChannelOf(provider, design.config.styling?.framework).kind === "style";
  return {
    snippets: design.snippets,
    ...(design.config.extensions ? { extensions: design.config.extensions } : {}),
    ...(target ? { target } : {}),
    ...(inlineStyle ? { inlineStyle: true } : {}),
  };
}

export default defineCommand({
  meta: {
    name: "emit",
    description: "Print or write agent-consumed IR for a screen.",
  },
  args: {
    screen: {
      type: "positional",
      required: false,
      description: "Screen id, or a path to a screen JSON. Omit to pick interactively.",
    },
    folder: {
      type: "string",
      description: FOLDER_ARG_DESCRIPTION,
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
    const interactive = Boolean(process.stdin.isTTY);
    const screenArg = args.screen;
    const looksLikePath = !!screenArg && (screenArg.includes("/") || screenArg.endsWith(".json"));
    const screenPath = looksLikePath
      ? resolve(screenArg)
      : (
          await pickScreen(
            await resolveDesignFolder(args.folder, "emit"),
            screenArg,
            interactive,
            "emit",
          )
        ).path;
    const screenJson = JSON.parse(await readFile(screenPath, "utf8"));
    const screen = ScreenSchema.parse(screenJson);

    const progress = createProgress();
    progress.start("preparing code");
    try {
      const componentsAlias = args["components-alias"] ?? (await readConfigAlias(screenPath));
      const context = await folderEmitContext(screenPath, screen);
      progress.step("generating code");

      const result = await emitCode(screen, {
        ...(componentsAlias ? { componentsAlias } : {}),
        ...context,
      });
      if (!result.ok) {
        progress.fail("code generation failed");
        const e = result.error;
        if (e.kind === "UnknownComponent") {
          fail("emit", `unknown component: ${JSON.stringify(e.ref)}`);
        } else if (e.kind === "SnippetNotFound") {
          fail("emit", `snippet not found: ${JSON.stringify(e.snippetId)}`);
        } else {
          fail("emit", `screen not found: ${JSON.stringify(e.screenId)}`);
        }
      }

      // Tailwind-channel emits against a v3 host app get the v4→v3 class
      // advisory (the canvas compiles v4, so design classes carry v4 semantics).
      const found = await findDesignConfig(screenPath);
      const tailwindV3Compat =
        found && !context?.target && !context?.inlineStyle
          ? detectTailwindMajor(hostAppRootFrom(found.folder, found.config.hostApp)) === 3
            ? v3ClassIssues([
                ...result.value.classesUsed,
                ...result.value.snippetsUsed.flatMap((s) => classNamesInJsx(s.jsx)),
              ])
            : []
          : [];

      if (args.to) {
        progress.step("writing code");
        const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);
        const ir =
          tailwindV3Compat.length > 0 ? { ...result.value, tailwindV3Compat } : result.value;
        await writeFile(outPath, JSON.stringify(ir, null, 2), "utf8");
        progress.succeed("generated code");
        console.log(`velloo emit: wrote ${outPath}`);
        return;
      }

      // Finish stderr progress before stdout becomes the generated-code payload.
      progress.succeed("generated code");
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
      for (const issue of tailwindV3Compat) {
        stdout.write(
          issue.v3
            ? `// tailwind v3 host: \`${issue.class}\` → \`${issue.v3}\` (${issue.note})\n`
            : `// tailwind v3 host: \`${issue.class}\` — ${issue.note}\n`,
        );
      }
      stdout.write("\n");
      stdout.write(`${result.value.jsx}\n`);
    } catch (error) {
      progress.fail("code generation failed");
      throw error;
    }
  },
});

async function readConfigAlias(screenPath: string): Promise<string | undefined> {
  const found = await findDesignConfig(screenPath);
  return found?.config.codegen?.componentsAlias;
}
