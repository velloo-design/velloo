import { join, relative, sep } from "node:path";
import { log, select, spinner } from "@clack/prompts";
import pc from "picocolors";
import type { AgentWiring } from "../connect/index.ts";
import { DEFAULT_THEME_PRESET, NEUTRAL_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost, findComponentsDir } from "../scan/detect.ts";
import { scanApps } from "../scan/index.ts";
import type {
  DetectedHost,
  InitialContent,
  LibraryId,
  LibrarySource,
  WizardAnswers,
} from "./answers.ts";
import { promptDesignMd } from "./design-md-prompt.ts";
import {
  DEFAULT_COMPONENTS_DIR,
  type HostContext,
  isAborted,
  noteSetup,
  subtitled,
  type WizardContext,
} from "./prompt-kit.ts";
import {
  DEFAULT_LIBRARY_ID,
  interactiveLibraryChoices,
  libraryForApp,
  libraryForSample,
  scanAdoption,
  WIZARD_PROVIDERS,
} from "./provider-registry.ts";
import { promptShareAndFeedback } from "./share-prompt.ts";
import { DEFAULT_STACK_ID, stackForFramework } from "./stacks.ts";

const UI_LIBRARY_NAMES: Record<NonNullable<DetectedHost["uiLibrary"]>, string> = {
  shadcn: "shadcn",
  html: "Server-rendered HTML",
  mui: "Material UI",
  antd: "Ant Design",
  chakra: "Chakra UI",
};

/**
 * The "Detected in your app" box: leads with the UI framework and what velloo
 * will do about it — a supported one becomes the folder's adapter, and an
 * unsupported one (Mantine, Untitled UI, …) or none at all means the
 * no-framework primitives, with the app's own components found by the setup
 * step. A shadcn app's own component files are what the canvas mounts, with
 * the snapshot only standing in per component.
 */
export function describeDetected(d: DetectedHost): string {
  let ui: string;
  let canvas: string;
  if (d.uiLibrary === "shadcn") {
    ui = `shadcn${d.shadcnStyle ? ` (${d.shadcnStyle})` : ""}`;
    canvas =
      "your app's own shadcn component files — Velloo's bundled copies stand in only where a file is missing, can't compile, or needs a canvas-safe adaptation (dialogs, menus, popovers)";
  } else if (d.uiLibrary) {
    const name = UI_LIBRARY_NAMES[d.uiLibrary];
    ui = name;
    canvas =
      Object.values(WIZARD_PROVIDERS).find((entry) => entry.scanMatch?.(d))?.detectedCanvas ??
      `real ${name} components bundled with Velloo`;
  } else if (d.unsupportedUi) {
    ui = `${d.unsupportedUi} (no Velloo adapter yet)`;
    canvas = "Velloo's no-library primitives stand in";
  } else {
    ui = "none detected";
    canvas = "Velloo's primitives to start — the setup step finds the components your app has";
  }
  const lines = [
    `UI library: ${ui}`,
    `Canvas uses: ${canvas}`,
    `Tailwind:   ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css:  ${d.globalsCssPath ?? "not found — will use a preset"}`,
    ...(d.designMdPath ? [`DESIGN.md:  ${d.designMdPath} — your design agents follow it`] : []),
  ];
  return lines.join("\n");
}

/**
 * Where the app keeps its UI components, relative to `appRoot` — found, never
 * asked. A shadcn app says so in `components.json` and the rest keep to a
 * handful of conventions; in a monorepo the directory is under the app that
 * was scanned, not the root. An app with none of them gets the conventional
 * path: only shadcn reads it, and only once components are added there.
 */
export function componentsDirFor(
  appRoot: string,
  scanRoot: string = appRoot,
  inherited?: string | undefined,
): string {
  // A sibling design folder already settled this for the same app — don't let
  // a second folder drift from the first.
  if (inherited) return inherited;
  const atRoot = findComponentsDir(appRoot);
  if (atRoot) return atRoot;
  const nested = scanRoot === appRoot ? undefined : findComponentsDir(scanRoot);
  if (!nested) return DEFAULT_COMPONENTS_DIR;
  return join(relative(appRoot, scanRoot), nested).split(sep).join("/");
}

/**
 * The library question — unless it's already decided. A pinned library (the
 * `--library` flag, a scan adoption, or the sibling design folder's choice)
 * is already resolved, so don't ask the user to choose it again. Returns null
 * on cancel.
 */
export async function resolveLibrary(
  ctx: Pick<WizardContext, "pinnedLibrary" | "pinnedLibraryReason">,
  initial: LibraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryId | null> {
  if (ctx.pinnedLibrary) {
    if (ctx.pinnedLibraryReason) {
      log.info(
        `Component library: ${WIZARD_PROVIDERS[ctx.pinnedLibrary].label} ${pc.dim(`(${ctx.pinnedLibraryReason})`)}`,
      );
    }
    return ctx.pinnedLibrary;
  }
  const picked = await select<LibraryId>({
    message: subtitled(
      "Component library",
      "What the canvas draws with, and what your emitted code imports.",
    ),
    options: interactiveLibraryChoices(),
    initialValue: initial,
  });
  return isAborted(picked) ? null : picked;
}

/**
 * Read the app for its UI library. An app that is there always settles it
 * (`libraryForApp`, or `libraryForSample` for the welcome sample); null means
 * there is no app to read, and the library is still a question.
 */
export async function tryAdoptLibraryFromApp(
  appRoot: string,
  scanDir?: string | undefined,
  forSample = false,
): Promise<{
  library: LibraryId;
  detected: DetectedHost;
  scanRoot: string;
  stack: string;
} | null> {
  const spin = spinner();
  spin.start("Detecting your app's UI library");
  try {
    const scanned = await scanApps(appRoot, scanDir);
    const primary = scanned.apps[0];
    const app = primary ?? scanned.roots[0];
    const scanRoot = app?.dir ?? appRoot;
    const detected = detectHost(scanRoot, appRoot);
    const claimed = scanAdoption(detected);
    const fallback = forSample ? libraryForSample : libraryForApp;
    const adopted = claimed ?? (app ? fallback(detected) : undefined);
    spin.stop(
      claimed
        ? `Detected ${WIZARD_PROVIDERS[claimed.library].label}`
        : adopted
          ? adopted.note
          : "No app found here — you'll pick a library next.",
    );
    if (!adopted) return null;
    return {
      library: adopted.library,
      detected,
      scanRoot,
      stack: stackForFramework(primary?.framework),
    };
  } catch {
    spin.stop("Couldn't scan the app — you'll pick a library next.");
    return null;
  }
}

/**
 * The questions every host-reading goal ends on: the library (unless decided),
 * then sharing — folded into the finished answers.
 */
export async function promptLibraryThemePath(
  ctx: HostContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
  initialContent: InitialContent,
  extra: Partial<WizardAnswers> = {},
  opts: { skipLibrary?: boolean } = {},
): Promise<WizardAnswers | null> {
  let library: LibraryId = ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID;
  if (!opts.skipLibrary) {
    const picked = await resolveLibrary(ctx);
    if (picked === null) return null;
    library = picked;
  }
  const source: LibrarySource = WIZARD_PROVIDERS[library].defaultSource;
  const componentsRelative = componentsDirFor(
    ctx.appRoot,
    extra.scanRoot,
    ctx.inheritComponentsDir,
  );
  // Only the sample wears the house theme; a start from the user's app (or a
  // blank one) is neutral until its own theme is found. A detected host theme
  // overrides this in `resolveTheme`.
  const themePreset = initialContent === "sample" ? DEFAULT_THEME_PRESET : NEUTRAL_THEME_PRESET;
  const useDesignMd = ctx.skipDesignMd
    ? false
    : await promptDesignMd(extra.detected, ctx.appRoot, themePreset);
  if (useDesignMd === null) return null;

  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  noteSetup(ctx.appRoot, folder);
  return {
    appRoot: ctx.appRoot,
    scanRoot: extra.scanRoot ?? ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent,
    themePreset,
    ...(useDesignMd !== undefined ? { useDesignMd } : {}),
    stack: extra.stack ?? DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
    ...extra,
  };
}
