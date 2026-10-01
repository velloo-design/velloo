import { readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { stdout } from "node:process";
import {
  classNamesInJsx,
  detectTailwindMajor,
  type EmitHtmlResult,
  emitCode,
  emitHtml,
  v3ClassIssues,
} from "@velloo/codegen";
import { type Screen, ScreenSchema } from "@velloo/schema";
import {
  emitFrameworkContextFor,
  hostAppRootFrom,
  loadDesignFolder,
  registryForScreen,
  resolveProviders,
} from "@velloo/server";
import { defineCommand } from "citty";
import { DESIGN_ARG_DESCRIPTION, pickScreen, resolveDesign } from "../design.ts";
import { findDesignConfig } from "../design-config.ts";
import { fail } from "../fail.ts";
import { createProgress } from "../progress.ts";

/**
 * Load the emit context a screen needs from its containing design folder:
 * snippets (so `@id` snippet refs resolve), extensions (so extension `$ref`s
 * resolve), and the screen framework's codegen target + style channel (so a MUI
 * or none/none folder emits its native idiom). The framework half comes from the
 * same resolver the MCP `emit_code` tool uses, so the two can't disagree.
 * Returns {} when the screen isn't inside a folder (a bare external path) —
 * emit still works, just without folder context.
 */
async function folderEmitContext(
  screenPath: string,
  screen: Screen,
): Promise<{
  emit: Partial<Parameters<typeof emitCode>[1]>;
  html?: EmitHtmlResult;
  /** Tailwind class diagnostics apply to this screen's emit. */
  tailwind: boolean;
}> {
  const found = await findDesignConfig(screenPath);
  if (!found) return { emit: {}, tailwind: true };
  const design = await loadDesignFolder(found.folder);
  const { providers, defaultProvider } = await resolveProviders(design.config, found.folder);
  const framework = await emitFrameworkContextFor(
    screen,
    providers,
    defaultProvider,
    design.config.styling?.framework,
  );
  if (framework.html) {
    const registry = registryForScreen(
      screen,
      providers,
      defaultProvider,
      design.config.extensions ?? {},
      design.config.styling?.framework,
    );
    return {
      emit: {},
      html: await emitHtml(screen, { registry, snippets: design.snippets }),
      tailwind: framework.tailwind,
    };
  }
  return {
    emit: {
      snippets: design.snippets,
      ...(design.config.extensions ? { extensions: design.config.extensions } : {}),
      target: framework.target,
      ...(framework.inlineStyle ? { inlineStyle: true } : {}),
    },
    tailwind: framework.tailwind,
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
    design: {
      type: "string",
      description: DESIGN_ARG_DESCRIPTION,
    },
    to: {
      type: "string",
      description:
        "Write IR as JSON to this path; for HTML screens, a .html path writes native markup. Omit to print the native body to stdout.",
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
            await resolveDesign(args.design, "emit", { designFlag: "--design" }),
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

      if (context.html) {
        const ir = context.html;
        progress.succeed("generated HTML");
        if (args.to) {
          const outPath = isAbsolute(args.to) ? args.to : resolve(args.to);
          const asMarkup = extname(outPath).toLowerCase() === ".html";
          await writeFile(outPath, asMarkup ? ir.html : JSON.stringify(ir, null, 2), "utf8");
          console.log(`velloo emit: wrote ${outPath}`);
          for (const warning of ir.warnings) console.log(`  note: ${warning}`);
        } else {
          stdout.write(`${ir.html}\n`);
        }
        return;
      }

      const result = await emitCode(screen, {
        ...(componentsAlias ? { componentsAlias } : {}),
        ...context.emit,
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
        found && context.tailwind
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
