import { resolve } from "node:path";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";

/**
 * Pure flag → answers logic for `velloo init`'s non-interactive mode.
 * Lives apart from the clack-driven wizard so the branching is
 * unit-testable without a TTY.
 */
export interface InitCliArgs {
  folder?: string;
  force?: boolean;
  nonInteractive?: boolean;
  library?: string;
  source?: string;
  appPath?: string;
  componentsDir?: string;
  initialContent?: string;
  themeColor?: string;
  themeVibe?: string;
}

export function isValidLibraryId(v: string): v is LibraryId {
  return v === "shadcn-react" || v === "shadcn-upstream" || v === "none" || v === "mui";
}

export function isValidSource(v: string): v is LibrarySource {
  return v === "binary" || v === "in-repo" || v === "cache";
}

export function isValidContent(v: string): v is InitialContent {
  return v === "sample" || v === "blank" || v === "scan";
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
      `unknown --library ${JSON.stringify(args.library)}. Valid: shadcn-upstream | shadcn-react | none | mui.`,
    );
  }
  if (args.source && !isValidSource(args.source)) {
    throw new Error(
      `unknown --source ${JSON.stringify(args.source)}. Valid: binary | in-repo | cache.`,
    );
  }
  if (args.initialContent && !isValidContent(args.initialContent)) {
    throw new Error(
      `unknown --initial-content ${JSON.stringify(args.initialContent)}. Valid: sample | blank | scan.`,
    );
  }
  const library: LibraryId = (args.library as LibraryId | undefined) ?? "shadcn-react";
  const source: LibrarySource = (args.source as LibrarySource | undefined) ?? "binary";
  if (source === "in-repo" && !args.appPath) {
    throw new Error(`--source=in-repo requires --app-path=<path-to-your-app>.`);
  }
  return {
    folder: resolve(args.folder ?? "design"),
    library,
    source,
    appPath: args.appPath ? resolve(args.appPath) : undefined,
    componentsRelative: args.componentsDir ?? "src/components/ui",
    initialContent: (args.initialContent as InitialContent | undefined) ?? "sample",
    themeColor: args.themeColor && args.themeColor.trim() !== "" ? args.themeColor : undefined,
    themeVibe: args.themeVibe && args.themeVibe.trim() !== "" ? args.themeVibe : undefined,
  };
}
