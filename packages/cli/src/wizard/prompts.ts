import { resolve } from "node:path";
import { cancel, isCancel, note, select, text } from "@clack/prompts";
import pc from "picocolors";
import { THEME_PRESETS } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";

function isAborted(value: unknown): value is symbol {
  return isCancel(value);
}

function abort(): null {
  cancel("Cancelled — no files were written.");
  return null;
}

/** A true-color terminal swatch (two blocks) for a hex color. */
function swatch(hex: string): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return "  ";
  const [r, g, b] = m.map((h) => Number.parseInt(h, 16));
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;
}

function describeDetected(d: ReturnType<typeof detectHost>): string {
  const lines = [
    `shadcn:    ${d.shadcn ? `yes${d.shadcnStyle ? ` (${d.shadcnStyle})` : ""}` : "not detected"}`,
    `Tailwind:  ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css: ${d.globalsCssPath ?? "not found — will use a preset"}`,
  ];
  return lines.join("\n");
}

/**
 * Interactive prompts for `velloo init`. `appRoot` is the user's app (where
 * Velloo installs); the flow asks scratch-vs-scan first, then only the
 * questions that choice needs.
 */
export async function runInteractive(ctx: { appRoot: string }): Promise<WizardAnswers | null> {
  const folderInput = await text({
    message: "Where should the design folder live?",
    placeholder: "velloo",
    defaultValue: "velloo",
    validate(value) {
      if (value && value.trim() === "") return "Path can't be empty.";
      return undefined;
    },
  });
  if (isAborted(folderInput)) return abort();
  const folder = resolve(ctx.appRoot, folderInput || "velloo");

  const start = await select<"scratch" | "scan">({
    message: "How do you want to start?",
    options: [
      {
        value: "scratch",
        label: "Start from scratch",
        hint: "Pick a component library + a sample or blank board",
      },
      {
        value: "scan",
        label: "Scan what I have",
        hint: "Detect your routes + theme and build a starting board",
      },
    ],
    initialValue: "scratch",
  });
  if (isAborted(start)) return abort();

  if (start === "scan") {
    const detected = detectHost(ctx.appRoot);
    note(describeDetected(detected), "Detected in your app");
    return {
      appRoot: ctx.appRoot,
      folder,
      // Scan renders against the bundled snapshot and imports the host theme;
      // it never writes into the app.
      library: "shadcn-react",
      source: "binary",
      componentsRelative: "src/components/ui",
      initialContent: "scan",
      detected,
    };
  }

  const library = await select<LibraryId>({
    message: "Component library",
    options: [
      {
        value: "shadcn-upstream",
        label: "shadcn (upstream)",
        hint: "Vanilla shadcn added to your app. Recommended.",
      },
      {
        value: "shadcn-react",
        label: "shadcn (vendored snapshot)",
        hint: "Bundled with velloo — shadcn is NOT downloaded.",
      },
      {
        value: "none",
        label: "No library",
        hint: "Box / Stack / Text primitives.",
      },
    ],
    initialValue: "shadcn-upstream",
  });
  if (isAborted(library)) return abort();

  // Source is derived from the library: upstream lives in the app (written
  // post-init), everything else renders from the bundled snapshot.
  let source: LibrarySource = "binary";
  let componentsRelative = "src/components/ui";
  if (library === "shadcn-upstream") {
    source = "in-repo";
    const cr = await text({
      message: "Components subfolder inside your app",
      placeholder: "src/components/ui",
      defaultValue: "src/components/ui",
    });
    if (isAborted(cr)) return abort();
    if (cr) componentsRelative = cr;
  }

  const initialContent = await select<Exclude<InitialContent, "scan">>({
    message: "Initial design",
    options: [
      {
        value: "sample",
        label: library === "none" ? "Welcome sample" : "Pulse sample",
        hint: library === "none" ? "A small primitives demo" : "7 screens, 3 boards",
      },
      { value: "blank", label: "Blank", hint: "Empty board, no screens" },
    ],
    initialValue: "sample",
  });
  if (isAborted(initialContent)) return abort();

  let themePreset: string | undefined;
  if (library === "shadcn-upstream" || library === "shadcn-react") {
    const preset = await select<string>({
      message: "Theme preset",
      options: THEME_PRESETS.map((p) => ({
        value: p.id,
        label: `${swatch(p.seed)} ${p.label}`,
      })),
      initialValue: "indigo",
    });
    if (isAborted(preset)) return abort();
    themePreset = typeof preset === "string" ? preset : undefined;
  }

  note(pc.dim(`App root: ${ctx.appRoot}\nDesign:   ${folder}`), "Setup");

  return {
    appRoot: ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent,
    themePreset,
  };
}
