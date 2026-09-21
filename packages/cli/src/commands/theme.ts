import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  colorizeDiff,
  type EmitDesignMdOptions,
  type EmitThemeResult,
  emitDesignMdFile,
  emitNativeTheme,
  emitTheme,
} from "@velloo/codegen";
import type { FrameworkAdapter } from "@velloo/provider";
import { type Theme, ThemeSchema } from "@velloo/schema";
import {
  guidanceSections,
  loadDesignFolder,
  readDesignSystemDoc,
  resolveProviders,
} from "@velloo/server";
import { defineCommand } from "citty";
import { DESIGN_ARG_DESCRIPTION, resolveDesign } from "../design.ts";
import { detectHost } from "../scan/detect.ts";

/** Read a file if it exists, else undefined. */
async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Resolve the folder's framework-native emit context: for a MUI folder, a
 * `createTheme()` producer (its native artifact); otherwise the Tailwind
 * globals.css producer, threaded with `theme/custom.css` (which the MCP
 * emit_theme passes but this command used to drop). Mirrors the MCP tool.
 */
/**
 * The DESIGN.md producer. A theme with a dark palette emits two files: the
 * format has no light/dark axis, so one file cannot carry both.
 */
async function designMdEmitter(
  design: Awaited<ReturnType<typeof loadDesignFolder>>,
  theme: Theme,
  outDir: string,
  systemName: string,
): Promise<(apply: boolean) => Promise<EmitThemeResult>> {
  // Read the document the folder follows, live — never a stored copy.
  const source = await readDesignSystemDoc(design);
  const prose = source ? (guidanceSections(source) as EmitDesignMdOptions["prose"]) : undefined;
  return async (apply) => {
    const files = [];
    const warnings: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      if (mode === "dark" && !theme.colorsDark) continue;
      const r = await emitDesignMdFile(theme, {
        outputDir: outDir,
        apply,
        mode,
        name: systemName,
        ...(prose ? { prose } : {}),
      });
      files.push(r.file);
      warnings.push(...r.warnings);
    }
    return {
      files,
      warnings: [...new Set(warnings)],
      notes: [
        prose === undefined
          ? "prose sections are generated from the tokens — point the design at a DESIGN.md to supply real intent"
          : "prose sections were read from the design system document this design follows",
        ...(theme.colorsDark
          ? ["DESIGN.md has no light/dark axis — the dark palette is a second file, DESIGN.dark.md"]
          : []),
      ],
    };
  };
}

async function themeEmitter(
  folderRoot: string,
  theme: Theme,
  outDir: string,
  cssOnly: boolean,
  tailwind3: boolean,
): Promise<{ native: boolean; produce: (apply: boolean) => Promise<EmitThemeResult> }> {
  const design = await loadDesignFolder(folderRoot);
  const { defaultProvider } = await resolveProviders(design.config, folderRoot);
  const adapter = defaultProvider as FrameworkAdapter;
  if (adapter.themeToNative && adapter.themeModule) {
    const toNative = adapter.themeToNative.bind(adapter);
    const spec = adapter.themeModule;
    return {
      native: true,
      produce: (apply) =>
        emitNativeTheme(toNative(theme), {
          spec,
          outputDir: outDir,
          apply,
          ...(theme.colorsDark ? { darkThemeOptions: toNative(theme, true) } : {}),
          sourceTheme: theme,
        }),
    };
  }
  const customCss = await readMaybe(join(folderRoot, "theme", "custom.css"));
  return {
    native: false,
    produce: (apply) =>
      emitTheme(theme, {
        outputDir: outDir,
        apply,
        cssOnly,
        ...(customCss ? { customCss } : {}),
        ...(tailwind3 ? { tailwindMajor: 3 as const } : {}),
      }),
  };
}

/**
 * Print diffs (or write files), then offer to apply on a TTY. Shared by the
 * framework and DESIGN.md producers so both behave identically.
 */
async function report(
  produce: (apply: boolean) => Promise<EmitThemeResult>,
  apply: boolean,
): Promise<void> {
  const result = await produce(apply);

  const useColor = stdout.isTTY === true;
  let anyChange = false;

  for (const warning of result.warnings) {
    console.error(`velloo theme export: warning: ${warning}`);
  }

  for (const file of result.files) {
    if (file.diff.identical) {
      console.log(`velloo theme export: ${file.path} is already up to date.`);
      continue;
    }
    anyChange = true;
    if (file.applied) {
      console.log(`velloo theme export: wrote ${file.path}`);
    } else {
      const rendered = useColor ? colorizeDiff(file.diff.diff) : file.diff.diff;
      stdout.write(`${rendered}\n`);
      stdout.write(`Would write to: ${file.path}\n\n`);
    }
  }

  for (const note of result.notes) {
    console.log(`velloo theme export: ${note}`);
  }

  if (!anyChange || apply) return;

  if (!stdin.isTTY) {
    console.log("(non-TTY) re-run with --apply to write the files.");
    return;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question("Apply all? (y/N) ")).trim().toLowerCase();
  rl.close();
  if (answer === "y" || answer === "yes") {
    const final = await produce(true);
    for (const file of final.files) {
      if (file.applied) console.log(`velloo theme export: wrote ${file.path}`);
    }
  } else {
    console.log("velloo theme export: skipped (no changes written).");
  }
}

const exportTheme = defineCommand({
  meta: {
    name: "export",
    description:
      "Export DTCG tokens.json plus the framework theme in diff mode — Tailwind v4 globals.css by default, or v3 CSS + preset when detected",
  },
  args: {
    to: {
      type: "string",
      required: true,
      description: "Target app directory (writes <to>/app/globals.css and <to>/tailwind.config.ts)",
    },
    design: {
      type: "string",
      description: DESIGN_ARG_DESCRIPTION,
    },
    theme: {
      type: "string",
      description: "Path to theme JSON (default: the design's theme/default.json)",
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
      description: "Emit the v4 artifacts even when the target app looks like Tailwind v3.",
    },
    format: {
      type: "string",
      description:
        'Output format: "framework" (default) or "design-md" for a Google Labs DESIGN.md.',
    },
  },
  async run({ args }) {
    const folderRoot = await resolveDesign(args.design, "theme export", { designFlag: "--design" });
    const themePath = args.theme ? resolve(args.theme) : join(folderRoot, "theme", "default.json");
    const outDir = isAbsolute(args.to) ? args.to : resolve(args.to);

    const themeJson = JSON.parse(await readFile(themePath, "utf8"));
    const theme = ThemeSchema.parse(themeJson);

    // Tailwind-major routing only applies to the Tailwind (shadcn) target — a
    // MUI folder emits a createTheme() module, not globals.css, so v3
    // detection is irrelevant there. A v3 target gets the v3 projection
    // (velloo-theme.css + velloo.preset) instead of `@theme` files a v3 build
    // can't compile; `--force-v4` restores the v4 output.
    if (args.format !== undefined && args.format !== "framework" && args.format !== "design-md") {
      console.error(
        `velloo theme export: unknown --format "${args.format}" (expected "framework" or "design-md").`,
      );
      process.exitCode = 1;
      return;
    }

    const tailwind3 = !args["force-v4"] && detectHost(outDir).tailwindMajor === 3;

    if (args.format === "design-md") {
      const design = await loadDesignFolder(folderRoot);
      const emit = await designMdEmitter(design, theme, outDir, design.config.name);
      await report(emit, Boolean(args.apply));
      return;
    }

    const { native, produce } = await themeEmitter(
      folderRoot,
      theme,
      outDir,
      Boolean(args["css-only"]),
      tailwind3,
    );
    if (!native && tailwind3) {
      console.log(
        "velloo theme export: target looks like Tailwind v3 — emitting velloo-theme.css + velloo.preset (pass --force-v4 for the v4 artifacts).",
      );
    }

    await report(produce, Boolean(args.apply));
  },
});

export default defineCommand({
  meta: { name: "theme", description: "Work with a design's theme" },
  subCommands: { export: exportTheme },
});
