import { note, select, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import type { AgentWiring } from "../connect/index.ts";
import { DEFAULT_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import { type AppsScanResult, primaryApp, scanApps } from "../scan/index.ts";
import type { ScannedRoute } from "../scan/types.ts";
import type {
  DetectedHost,
  InitialContent,
  LibraryId,
  LibrarySource,
  WizardAnswers,
} from "./answers.ts";
import {
  describeDetected,
  promptLibraryThemePath,
  resolveComponentsDir,
  resolveLibrary,
  tryAdoptLibraryFromApp,
} from "./library-prompts.ts";
import {
  DEFAULT_COMPONENTS_DIR,
  type HostContext,
  isAborted,
  noteSetup,
  subtitled,
  type WizardContext,
} from "./prompt-kit.ts";
import { DEFAULT_LIBRARY_ID, scanAdoption, WIZARD_PROVIDERS } from "./provider-registry.ts";
import { promptShareAndFeedback } from "./share-prompt.ts";
import { DEFAULT_STACK_ID, stackForFramework } from "./stacks.ts";

/** Redesign a screen: pick a scanned route (or name one), then the shared tail. */
export async function promptRedesignScreen(
  ctx: HostContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
): Promise<WizardAnswers | null> {
  const how = await select<"scan" | "type">({
    message: subtitled(
      "Which screen should your agent redesign?",
      "Scanning finds your real routes; typing a name works for a screen that doesn't exist yet.",
    ),
    options: [
      {
        value: "scan",
        label: "Pick from my app's routes",
        hint: "Scan routes and choose one",
      },
      {
        value: "type",
        label: "Type a screen name",
        hint: "e.g. Pricing, Settings, Checkout",
      },
    ],
    initialValue: "scan",
  });
  if (isAborted(how)) return null;

  let selectedRoutes: ScannedRoute[] | undefined;
  let screenName: string | undefined;
  let scanRoot = ctx.appRoot;
  let detected: DetectedHost | undefined;
  let library: LibraryId = ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID;
  let stack = DEFAULT_STACK_ID;

  if (how === "scan") {
    const spin = spinner();
    spin.start("Scanning your app's routes");
    const scanned = await scanApps(ctx.appRoot, ctx.scanDir);
    const appsSuffix = scanned.apps.length > 1 ? ` across ${scanned.apps.length} apps` : "";
    spin.stop(
      scanned.routes.length > 0
        ? `Found ${scanned.routes.length} screen${scanned.routes.length === 1 ? "" : "s"}${appsSuffix}`
        : "No routes detected — type a screen name instead.",
    );

    if (scanned.routes.length === 0) {
      const typed = await promptScreenName();
      if (typed === null) return null;
      screenName = typed;
    } else {
      const rankPrimary = scanned.apps[0];
      if (scanned.apps.length > 1) {
        const lines = scanned.apps.map(
          (a) =>
            `${pc.cyan(a.rel || ".")} — ${a.routes.length} screen${a.routes.length === 1 ? "" : "s"}`,
        );
        note(lines.join("\n"), `Found ${scanned.apps.length} apps`);
      }
      let host = detectHost(rankPrimary?.dir ?? ctx.appRoot);
      note(describeDetected(host), "Detected in your app");

      const picked = await pickOneScreen(scanned);
      if (picked === null) return null;
      selectedRoutes = [picked];
      screenName = picked.name;
      const primary = primaryApp(scanned.apps, [picked]) ?? rankPrimary;
      scanRoot = primary?.dir ?? ctx.appRoot;
      if (primary && primary !== rankPrimary) host = detectHost(primary.dir);
      detected = host;
      stack = stackForFramework(primary?.framework);
      if (!ctx.pinnedLibrary) {
        const adopted = scanAdoption(host);
        if (adopted) library = adopted.library;
      }
    }
  } else {
    const typed = await promptScreenName();
    if (typed === null) return null;
    screenName = typed;
    // Naming a screen skips the route scan, but the library question is still
    // answerable from the host — detect it rather than asking.
    if (!ctx.pinnedLibrary) {
      const adopted = await tryAdoptLibraryFromApp(ctx.appRoot, ctx.scanDir);
      if (adopted) {
        note(describeDetected(adopted.detected), "Detected in your app");
        detected = adopted.detected;
        scanRoot = adopted.scanRoot;
        library = adopted.library;
        stack = adopted.stack;
      }
    }
  }

  const adoptedLibrary = detected ? scanAdoption(detected)?.library : undefined;
  const rest = await promptLibraryThemePath(
    { ...ctx, pinnedLibrary: ctx.pinnedLibrary ?? adoptedLibrary ?? library },
    folder,
    agentWiring,
    "redesign-screen",
    { screenName, selectedRoutes, detected, scanRoot, stack },
    {
      skipLibrary: Boolean(ctx.pinnedLibrary || adoptedLibrary),
      libraryOnly: Boolean(adoptedLibrary),
    },
  );
  if (!rest) return null;
  const finalLibrary = ctx.pinnedLibrary ?? adoptedLibrary ?? rest.library;
  return {
    ...rest,
    library: finalLibrary,
    source: WIZARD_PROVIDERS[finalLibrary].defaultSource,
    scanRoot,
    ...(detected ? { detected } : {}),
    ...(selectedRoutes ? { selectedRoutes } : {}),
    ...(screenName ? { screenName } : {}),
  };
}

/** A typed screen name; null when the user cancelled. */
async function promptScreenName(): Promise<string | null> {
  const typed = await text({
    message: "Screen name",
    placeholder: "e.g. Pricing",
    validate(value) {
      if (!value?.trim()) return "Enter a screen name.";
      return undefined;
    },
  });
  return isAborted(typed) ? null : String(typed).trim();
}

/** Pick exactly one scanned route (redesign-a-screen). */
async function pickOneScreen(scanned: AppsScanResult): Promise<ScannedRoute | null> {
  const { routes } = scanned;
  const choice = await select<string>({
    message: "Which screen?",
    options: routes.map((r) => ({
      value: r.id,
      label: r.name,
      hint: r.routePath,
    })),
    ...(routes[0] ? { initialValue: routes[0].id } : {}),
  });
  if (isAborted(choice)) return null;
  return routes.find((r) => r.id === choice) ?? null;
}

/** The welcome sample: library, components subfolder, sharing. */
export async function promptSample(
  ctx: HostContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
): Promise<WizardAnswers | null> {
  const library = await resolveLibrary(ctx);
  if (library === null) return null;
  const provider = WIZARD_PROVIDERS[library];
  const source: LibrarySource = provider.defaultSource;
  let componentsRelative = DEFAULT_COMPONENTS_DIR;
  if (provider.asksComponentsSubfolder) {
    const dir = await resolveComponentsDir(ctx.appRoot, ctx.hasHostApp, ctx.inheritComponentsDir);
    if (!dir) return null;
    componentsRelative = dir.value;
  }

  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  noteSetup(ctx.appRoot, folder);
  return {
    appRoot: ctx.appRoot,
    scanRoot: ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent: "sample",
    themePreset: DEFAULT_THEME_PRESET,
    stack: DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
  };
}

/** Blank mode: detect an existing app's library, otherwise ask as before. */
export async function buildBlankAnswers(
  ctx: WizardContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
  defaultLibrary: LibraryId = "none",
): Promise<WizardAnswers | null> {
  const adopted = ctx.pinnedLibrary ? null : await tryAdoptLibraryFromApp(ctx.appRoot, ctx.scanDir);
  if (adopted) {
    note(describeDetected(adopted.detected), "Detected in your app");
    note(`Using ${WIZARD_PROVIDERS[adopted.library].label}.`, "Library");
  }
  const library = adopted?.library ?? (await resolveLibrary(ctx, defaultLibrary));
  if (library === null) return null;
  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  noteSetup(ctx.appRoot, folder);
  // No boards, neutral theme, default stack.
  return {
    appRoot: ctx.appRoot,
    scanRoot: adopted?.scanRoot ?? ctx.appRoot,
    folder,
    library,
    source: WIZARD_PROVIDERS[library].defaultSource,
    componentsRelative: ctx.inheritComponentsDir ?? DEFAULT_COMPONENTS_DIR,
    initialContent: "blank",
    themePreset: "zinc",
    stack: adopted?.stack ?? DEFAULT_STACK_ID,
    ...(adopted ? { detected: adopted.detected } : {}),
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
  };
}

/**
 * Brand / component / custom: scan the host first and auto-adopt its library
 * when detectable, so we don't ask unless adoption fails or --library pinned.
 */
export async function promptGoalWithAdoptedLibrary(
  ctx: HostContext,
  folder: string,
  agentWiring: AgentWiring | undefined,
  initialContent: InitialContent,
  extra: Partial<WizardAnswers> = {},
): Promise<WizardAnswers | null> {
  const adopted = ctx.pinnedLibrary ? null : await tryAdoptLibraryFromApp(ctx.appRoot, ctx.scanDir);
  if (adopted) {
    note(describeDetected(adopted.detected), "Detected in your app");
    note(`Using ${WIZARD_PROVIDERS[adopted.library].label}.`, "Library");
  }
  return promptLibraryThemePath(
    {
      ...ctx,
      pinnedLibrary: ctx.pinnedLibrary ?? adopted?.library,
    },
    folder,
    agentWiring,
    initialContent,
    {
      ...extra,
      ...(adopted
        ? { detected: adopted.detected, scanRoot: adopted.scanRoot, stack: adopted.stack }
        : {}),
    },
    {
      skipLibrary: Boolean(ctx.pinnedLibrary || adopted),
      // Host detection already framed the library; skip theme/stack/subfolder
      // and import the host theme in resolveTheme when available.
      libraryOnly: Boolean(adopted),
    },
  );
}
