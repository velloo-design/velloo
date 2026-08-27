import { resolve } from "node:path";
import { PRODUCT_SURFACES, type ProductSurface } from "../scaffold/sample-page.ts";
import { isValidPreset } from "../scaffold/theme-presets.ts";
import { isValidVibe } from "../scaffold/vibes.ts";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";
import { DEFAULT_LIBRARY_ID, LIBRARY_IDS, WIZARD_PROVIDERS } from "./provider-registry.ts";
import { isValidStack } from "./stacks.ts";

/**
 * Pure flag → answers logic for `velloo init`'s non-interactive mode.
 * Lives apart from the clack-driven wizard so the branching is
 * unit-testable without a TTY. Host detection (for scan) is deferred to
 * `init.ts` so this stays a pure function of its inputs.
 */
export interface InitCliArgs {
  /** Positional: the app root where Velloo installs (default: cwd). */
  folder?: string;
  /** Design folder, relative to the app root (default: `velloo`). */
  designFolder?: string;
  force?: boolean;
  nonInteractive?: boolean;
  /** Wire MCP config + guidance for Claude Code + Cursor (default true). */
  connect?: boolean;
  /** `scratch` | `scan`. */
  start?: string;
  /** Subfolder (relative to the app root) to scan when the UI isn't at the root. */
  scanDir?: string;
  library?: string;
  componentsDir?: string;
  initialContent?: string;
  /** Pulse slice for a shadcn sample: saas | analytics | marketing. */
  surface?: string;
  themePreset?: string;
  /** Vibe id (theme by feel) — mutually exclusive with --theme-preset. */
  vibe?: string;
  /** App stack: nextjs | vite | astro | remix — sets codegen.componentsAlias. */
  stack?: string;
  /** Project name for the repo's velloo.json (default: derived from the folder path). */
  project?: string;
}

export function isValidLibraryId(v: string): v is LibraryId {
  return (LIBRARY_IDS as string[]).includes(v);
}

export function isValidContent(v: string): v is InitialContent {
  return v === "sample" || v === "blank" || v === "scan";
}

export function isValidStart(v: string): v is "scratch" | "scan" {
  return v === "scratch" || v === "scan";
}

/**
 * Auto-decide whether to run the interactive wizard. Skips when stdin
 * isn't a TTY (CI, piping, scripted invocations) or when the user
 * passes `--non-interactive`. The TTY state is a parameter so tests
 * can exercise both branches.
 */
export function shouldRunWizard(args: { nonInteractive?: boolean }, stdinIsTTY: boolean): boolean {
  if (args.nonInteractive) return false;
  return stdinIsTTY;
}

export function answersFromArgs(args: InitCliArgs): WizardAnswers {
  // Unset flags get defaults; set-but-invalid flags fail loudly — a
  // typo'd --library silently scaffolding the wrong provider is worse
  // than an error.
  if (args.library && !isValidLibraryId(args.library)) {
    throw new Error(
      `unknown --library ${JSON.stringify(args.library)}. Valid: ${LIBRARY_IDS.join(" | ")}.`,
    );
  }
  if (args.start && !isValidStart(args.start)) {
    throw new Error(`unknown --start ${JSON.stringify(args.start)}. Valid: scratch | scan.`);
  }
  if (args.initialContent && !isValidContent(args.initialContent)) {
    throw new Error(
      `unknown --initial-content ${JSON.stringify(args.initialContent)}. Valid: sample | blank | scan.`,
    );
  }
  const themePreset = args.themePreset?.trim() || undefined;
  if (themePreset && !isValidPreset(themePreset)) {
    throw new Error(`unknown --theme-preset ${JSON.stringify(args.themePreset)}.`);
  }
  const themeVibe = args.vibe?.trim() || undefined;
  if (themeVibe && !isValidVibe(themeVibe)) {
    throw new Error(`unknown --vibe ${JSON.stringify(args.vibe)}.`);
  }
  if (themePreset && themeVibe) {
    throw new Error("pass one of --theme-preset or --vibe, not both.");
  }
  const stack = args.stack?.trim() || undefined;
  if (stack && !isValidStack(stack)) {
    throw new Error(
      `unknown --stack ${JSON.stringify(args.stack)}. Valid: nextjs | vite | astro | remix.`,
    );
  }

  const appRoot = resolve(args.folder ?? ".");
  const folder = resolve(appRoot, args.designFolder ?? "velloo");
  const library: LibraryId = (args.library as LibraryId | undefined) ?? DEFAULT_LIBRARY_ID;

  const scan = args.start === "scan" || args.initialContent === "scan";
  const initialContent: InitialContent = scan
    ? "scan"
    : ((args.initialContent as InitialContent | undefined) ?? "sample");

  const surface = args.surface?.trim() || undefined;
  if (surface && !PRODUCT_SURFACES.includes(surface as ProductSurface)) {
    throw new Error(
      `unknown --surface ${JSON.stringify(args.surface)}. Valid: saas | analytics | marketing.`,
    );
  }
  // The surface picks a slice of the shadcn Pulse sample — meaningless (so
  // loudly rejected) for libraries without product surfaces or non-sample
  // content.
  if (surface && !WIZARD_PROVIDERS[library].hasProductSurfaces) {
    throw new Error(`--surface only applies to the shadcn sample, not --library=${library}.`);
  }
  if (surface && initialContent !== "sample") {
    throw new Error(
      `--surface only applies to the sample (got --initial-content=${initialContent}).`,
    );
  }

  // Upstream components live in the app (written post-init); everything else
  // renders from the bundled snapshot. Init writes nothing to the app.
  const source: LibrarySource = WIZARD_PROVIDERS[library].defaultSource;

  return {
    appRoot,
    // Default to the app root; the scan flow finalizes this in init.ts (which
    // can run async --scan-dir / auto-discovery — answersFromArgs stays pure).
    scanRoot: appRoot,
    folder,
    library,
    source,
    componentsRelative: args.componentsDir ?? "src/components/ui",
    initialContent,
    ...(surface ? { productSurface: surface as ProductSurface } : {}),
    themePreset,
    ...(themeVibe ? { themeVibe } : {}),
    ...(stack ? { stack } : {}),
  };
}
