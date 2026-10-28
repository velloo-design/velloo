import { relative, sep } from "node:path";
import type { InitApp } from "@velloo/protocol/init";
import { importThemeFromDesignMd } from "../scaffold/import-design-md.ts";
import { NEUTRAL_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import { scanApps } from "../scan/index.ts";
import type { ScannedRoute } from "../scan/types.ts";
import type { DetectedHost, LibraryId } from "../wizard/answers.ts";
import {
  DEFAULT_LIBRARY_ID,
  libraryForApp,
  libraryForSample,
  WIZARD_PROVIDERS,
} from "../wizard/provider-registry.ts";
import { DEFAULT_STACK_ID, stackForFramework } from "../wizard/stacks.ts";

const UI_LIBRARY_NAMES: Record<NonNullable<DetectedHost["uiLibrary"]>, string> = {
  shadcn: "shadcn",
  html: "Server-rendered HTML",
  mui: "Material UI",
  antd: "Ant Design",
  chakra: "Chakra UI",
};

/** Everything init needs to know about the app, read once and nothing asked. */
export interface AppReading {
  /** UI code was found: an app, or a root with UI in it. */
  found: boolean;
  /** Where its UI lives — the app root, or a nested app (`web/`). */
  scanRoot: string;
  detected: DetectedHost;
  routes: ScannedRoute[];
  stack: string;
  /** The library a design of the app is made of. */
  library: LibraryId;
  libraryNote: string;
  /** The library the welcome sample is composed with here. */
  sampleLibrary: LibraryId;
}

/**
 * Read the app the way the terminal wizard used to, without its spinners: an
 * app settles its own library (the framework it uses, else the no-library
 * provider); with no app to read, the default stands.
 */
export async function readApp(appRoot: string, scanDir?: string): Promise<AppReading> {
  const scanned = await scanApps(appRoot, scanDir).catch(() => null);
  const primary = scanned?.apps[0];
  const app = primary ?? scanned?.roots[0];
  const scanRoot = app?.dir ?? appRoot;
  const detected = detectHost(scanRoot, appRoot);
  const adopted = app ? libraryForApp(detected) : undefined;
  return {
    found: Boolean(app),
    scanRoot,
    detected,
    routes: scanned?.routes ?? [],
    stack: primary ? stackForFramework(primary.framework) : DEFAULT_STACK_ID,
    library: adopted?.library ?? DEFAULT_LIBRARY_ID,
    libraryNote: libraryNote(Boolean(app), detected, adopted?.note),
    sampleLibrary: app ? libraryForSample(detected).library : DEFAULT_LIBRARY_ID,
  };
}

/**
 * The line under the app's summary. A library a provider claims is named on
 * the page already, and "no UI library" is too; what's left is what follows
 * from it.
 */
function libraryNote(app: boolean, detected: DetectedHost, note: string | undefined): string {
  if (!app) return "No app here — the design starts on the default library.";
  if (detected.unsupportedUi) return note ?? "";
  if (detected.uiLibrary) return "";
  return "The design starts on Velloo's primitives, and the setup step finds the components your app has.";
}

const rel = (appRoot: string, path: string) => relative(appRoot, path).split(sep).join("/");

/**
 * A DESIGN.md that names color roles, with how many. One written in neither
 * Velloo's nor Material 3's vocabulary maps poorly, and then the stylesheet is
 * the better theme — said before the design is made, not found on the canvas.
 */
function designMdOffer(appRoot: string, detected: DetectedHost): InitApp["designMd"] {
  if (!detected.designMdPath) return undefined;
  const imported = importThemeFromDesignMd(detected.designMdPath, NEUTRAL_THEME_PRESET);
  if (!imported) return undefined;
  const { semantic, semanticTotal } = imported.coverage;
  return {
    path: rel(appRoot, detected.designMdPath),
    system: imported.designSystem,
    mapped: semantic,
    total: semanticTotal,
    recommended: !(semantic < semanticTotal / 2 && detected.globalsCssPath),
  };
}

/** The reading as the page shows it. */
export function describeApp(appRoot: string, reading: AppReading): InitApp {
  const { detected } = reading;
  const designMd = designMdOffer(appRoot, detected);
  const uiLibrary = detected.uiLibrary
    ? UI_LIBRARY_NAMES[detected.uiLibrary]
    : detected.unsupportedUi;
  return {
    found: reading.found,
    library: { id: reading.library, label: WIZARD_PROVIDERS[reading.library].label },
    libraryNote: reading.libraryNote,
    ...(uiLibrary ? { uiLibrary } : {}),
    ...(detected.tailwindMajor ? { tailwind: detected.tailwindMajor } : {}),
    ...(detected.globalsCssPath ? { themeSource: rel(appRoot, detected.globalsCssPath) } : {}),
    ...(designMd ? { designMd } : {}),
    routes: reading.routes.map((route) => ({
      id: route.id,
      name: route.name,
      routePath: route.routePath,
      ...(route.appRel ? { app: route.appRel } : {}),
    })),
  };
}
