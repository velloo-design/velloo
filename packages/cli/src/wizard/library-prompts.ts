import { log, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import type { AgentWiring } from "../connect/index.ts";
import { DEFAULT_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost, findComponentsDir } from "../scan/detect.ts";
import { scanApps } from "../scan/index.ts";
import type {
  DetectedHost,
  InitialContent,
  LibraryId,
  LibrarySource,
  WizardAnswers,
} from "./answers.ts";
import {
  DEFAULT_COMPONENTS_DIR,
  type HostContext,
  isAborted,
  noteSetup,
  subtitled,
  subtitledText,
  type WizardContext,
} from "./prompt-kit.ts";
import {
  DEFAULT_LIBRARY_ID,
  interactiveLibraryChoices,
  scanAdoption,
  WIZARD_PROVIDERS,
} from "./provider-registry.ts";
import { promptShareAndFeedback } from "./share-prompt.ts";
import { DEFAULT_STACK_ID, stackForFramework } from "./stacks.ts";

const UI_LIBRARY_NAMES: Record<NonNullable<DetectedHost["uiLibrary"]>, string> = {
  shadcn: "shadcn",
  mui: "Material UI",
  antd: "Ant Design",
  chakra: "Chakra UI",
};

/**
 * The "Detected in your app" box: leads with the UI framework and what velloo
 * will do about it — a supported one becomes the folder's adapter, an
 * unsupported one (Mantine, Untitled UI, …) falls back to the no-framework
 * primitives, and none at all means velloo's bundled shadcn snapshot.
 */
export function describeDetected(d: DetectedHost): string {
  let ui: string;
  let canvas: string;
  if (d.uiLibrary === "shadcn") {
    ui = `shadcn${d.shadcnStyle ? ` (${d.shadcnStyle})` : ""}`;
    canvas =
      "Velloo's own bundled shadcn components — your app's files are not imported, so designs stay in sync by matching the same upstream shadcn";
  } else if (d.uiLibrary) {
    const name = UI_LIBRARY_NAMES[d.uiLibrary];
    ui = name;
    canvas = `real ${name} components bundled with Velloo`;
  } else if (d.unsupportedUi) {
    ui = `${d.unsupportedUi} (no Velloo adapter yet)`;
    canvas = "Velloo's no-library primitives stand in";
  } else {
    ui = "none detected";
    canvas = "Velloo's own bundled shadcn components";
  }
  const lines = [
    `UI library: ${ui}`,
    `Canvas uses: ${canvas}`,
    `Tailwind:   ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css:  ${d.globalsCssPath ?? "not found — will use a preset"}`,
  ];
  return lines.join("\n");
}

/**
 * Where the app keeps its UI components. Nothing to ask when there's no app to
 * put them in, and nothing to ask when the app already has a recognizable
 * components directory — only a real app with an unconventional layout gets
 * the question. Returns null when the user cancelled.
 */
export async function resolveComponentsDir(
  appRoot: string,
  hasHostApp: boolean,
  inherited?: string | undefined,
): Promise<{ value: string } | null> {
  // A sibling design folder already answered this for the same app — don't
  // ask twice, and don't let a second folder drift from the first.
  if (inherited) return { value: inherited };
  if (!hasHostApp) return { value: DEFAULT_COMPONENTS_DIR };
  const found = findComponentsDir(appRoot);
  if (found) return { value: found };
  const typed = await text({
    message: subtitledText(
      "Components subfolder inside your app",
      "Where your UI components live — emitted code imports from this path.",
    ),
    placeholder: DEFAULT_COMPONENTS_DIR,
    defaultValue: DEFAULT_COMPONENTS_DIR,
  });
  if (isAborted(typed)) return null;
  return { value: typed || DEFAULT_COMPONENTS_DIR };
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

/** Soft host scan — returns null when nothing adoptable is found. */
export async function tryAdoptLibraryFromApp(
  appRoot: string,
  scanDir?: string | undefined,
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
    const scanRoot = primary?.dir ?? appRoot;
    const detected = detectHost(scanRoot);
    const adopted = scanAdoption(detected);
    spin.stop(
      adopted
        ? `Detected ${WIZARD_PROVIDERS[adopted.library].label}`
        : "No UI library detected — you'll pick one next.",
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
 * the components subfolder, then sharing — folded into the finished answers.
 */
export async function promptLibraryThemePath(
  ctx: HostContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
  initialContent: InitialContent,
  extra: Partial<WizardAnswers> = {},
  opts: { skipLibrary?: boolean; libraryOnly?: boolean } = {},
): Promise<WizardAnswers | null> {
  let library: LibraryId = ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID;
  if (!opts.skipLibrary) {
    const picked = await resolveLibrary(ctx);
    if (picked === null) return null;
    library = picked;
  }
  const provider = WIZARD_PROVIDERS[library];
  const source: LibrarySource = provider.defaultSource;
  let componentsRelative = DEFAULT_COMPONENTS_DIR;

  if (!opts.libraryOnly && provider.asksComponentsSubfolder) {
    const dir = await resolveComponentsDir(ctx.appRoot, ctx.hasHostApp, ctx.inheritComponentsDir);
    if (!dir) return null;
    componentsRelative = dir.value;
  }
  // Blank stays deliberately neutral; every other start gets the house theme.
  // A detected host theme overrides this in `resolveTheme`.
  const themePreset = initialContent === "blank" ? "zinc" : DEFAULT_THEME_PRESET;

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
    stack: extra.stack ?? DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
    ...extra,
  };
}
