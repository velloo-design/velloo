import { resolve } from "node:path";
import { isValidPreset } from "../scaffold/theme-presets.ts";
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
  folder?: string | undefined;
  /** Design folder, relative to the app root (default: `velloo`). */
  designFolder?: string | undefined;
  /**
   * Skip the existing-folder menu and go straight to adding another design
   * folder — what `velloo folder add` runs. With `designFolder`, the wizard's
   * "where should it live?" prompt is answered too.
   */
  addFolder?: boolean | undefined;
  external?: boolean | undefined;
  force?: boolean | undefined;
  nonInteractive?: boolean | undefined;
  /** Wire MCP config + guidance for Claude Code + Cursor (default true). */
  connect?: boolean | undefined;
  /**
   * Start goal: redesign-screen | redesign-component | custom |
   * sample | blank | scratch (→ sample) | scan (legacy multi-route).
   */
  start?: string | undefined;
  /** Subfolder (relative to the app root) to scan when the UI isn't at the root. */
  scanDir?: string | undefined;
  library?: string | undefined;
  componentsDir?: string | undefined;
  initialContent?: string | undefined;
  themePreset?: string | undefined;
  /** App stack: nextjs | vite | astro | remix — sets codegen.componentsAlias. */
  stack?: string | undefined;
  /** Project name for the repo's velloo.json (default: derived from the folder path). */
  project?: string | undefined;
  /** Screen name for redesign-screen (typed; optional if routes are scanned). */
  screenName?: string | undefined;
  /** Component name/description for redesign-component. */
  component?: string | undefined;
  /** Free-text custom design request. */
  request?: string | undefined;
}

const START_TO_CONTENT: Record<string, InitialContent> = {
  "redesign-screen": "redesign-screen",
  "redesign-component": "component",
  custom: "custom",
  sample: "sample",
  blank: "blank",
  scratch: "sample",
  scan: "scan",
};

export function isValidLibraryId(v: string): v is LibraryId {
  return (LIBRARY_IDS as string[]).includes(v);
}

function isValidContent(v: string): v is InitialContent {
  return (
    v === "sample" ||
    v === "blank" ||
    v === "scan" ||
    v === "redesign-screen" ||
    v === "component" ||
    v === "custom"
  );
}

function isValidStart(v: string): boolean {
  return v in START_TO_CONTENT;
}

/**
 * Auto-decide whether to run the interactive wizard. Skips when stdin
 * isn't a TTY (CI, piping, scripted invocations) or when the user
 * passes `--non-interactive`. The TTY state is a parameter so tests
 * can exercise both branches.
 */
export function shouldRunWizard(
  args: { nonInteractive?: boolean | undefined },
  stdinIsTTY: boolean,
): boolean {
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
    throw new Error(
      `unknown --start ${JSON.stringify(args.start)}. Valid: redesign-screen | redesign-component | custom | sample | blank | scan.`,
    );
  }
  if (args.initialContent && !isValidContent(args.initialContent)) {
    throw new Error(
      `unknown --initial-content ${JSON.stringify(args.initialContent)}. Valid: sample | blank | scan | redesign-screen | component | custom.`,
    );
  }
  const themePreset = args.themePreset?.trim() || undefined;
  if (themePreset && !isValidPreset(themePreset)) {
    throw new Error(`unknown --theme-preset ${JSON.stringify(args.themePreset)}.`);
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

  let initialContent: InitialContent =
    (args.initialContent as InitialContent | undefined) ?? "sample";
  if (args.start) {
    initialContent = START_TO_CONTENT[args.start] ?? initialContent;
  }

  const screenName = args.screenName?.trim() || undefined;
  const componentDescription = args.component?.trim() || undefined;
  const customRequest = args.request?.trim() || undefined;

  if (initialContent === "component" && !componentDescription) {
    throw new Error("--component is required for --start=redesign-component.");
  }
  if (initialContent === "custom" && !customRequest) {
    throw new Error("--request is required for --start=custom.");
  }
  if (initialContent === "redesign-screen" && !screenName && args.start === "redesign-screen") {
    // Allow omitting screen name when a scan will fill selectedRoutes in init.ts;
    // require it only when we can't scan (caller can still pass --screen-name).
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
    themePreset,
    ...(stack ? { stack } : {}),
    ...(screenName ? { screenName } : {}),
    ...(componentDescription ? { componentDescription } : {}),
    ...(customRequest ? { customRequest } : {}),
  };
}
