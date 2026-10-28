import { join, resolve } from "node:path";
import type { InitCheckBody, InitCreateBody, InitGoal } from "@velloo/protocol/init";
import { designNameIssue } from "@velloo/schema";
import { isDesignFolderSync, isEmptyOrMissingSync } from "../design.ts";
import { chooseDesignName, isWithin } from "../manifest.ts";
import { DEFAULT_THEME_PRESET, NEUTRAL_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import type { InitialContent, LibraryId, WizardAnswers } from "../wizard/answers.ts";
import { isValidLibraryId } from "../wizard/args.ts";
import { componentsDirFor } from "../wizard/components-dir.ts";
import { libraryForApp, WIZARD_PROVIDERS } from "../wizard/provider-registry.ts";
import { DEFAULT_STACK_ID } from "../wizard/stacks.ts";
import type { AppReading } from "./read-app.ts";

/** What the command line settled before the page opened. */
export interface InitRun {
  /** The directory init ran in. */
  launchRoot: string;
  scanDir?: string | undefined;
  /** `--library`, or the library of the design already here. */
  pinnedLibrary?: LibraryId | undefined;
  inheritComponentsDir?: string | undefined;
  /** `--no-design-md`. */
  skipDesignMd?: boolean | undefined;
  /** The design's place, chosen on the command line. */
  fixed?: { storage: "repository" | "external" | "custom"; folder: string } | undefined;
  /** A design is already here, so the default folder is a second one's. */
  secondFolder: boolean;
  /** The folder Velloo-managed storage would use, decided once per run. */
  managedId: string;
  managedFolder: string;
}

export const repositoryFolderName = (run: Pick<InitRun, "secondFolder">) =>
  run.secondFolder ? "velloo-brand" : "velloo";

export interface Place {
  folder: string;
  /** Set when the design goes to Velloo-managed storage. */
  managedId?: string;
}

/** Where a design asked for goes, or why it can't go there. */
export async function placeFor(
  body: InitCheckBody,
  run: InitRun,
): Promise<{ place: Place; problem?: string }> {
  const storage = run.fixed?.storage ?? body.storage;
  const place: Place =
    storage === "external"
      ? { folder: run.managedFolder, managedId: run.managedId }
      : {
          folder: run.fixed
            ? run.fixed.folder
            : resolve(
                run.launchRoot,
                storage === "custom" ? body.folder?.trim() || "" : repositoryFolderName(run),
              ),
        };
  if (storage === "custom" && !run.fixed && !body.folder?.trim())
    return { place, problem: "Enter a folder for the design." };
  if (isDesignFolderSync(place.folder))
    return { place, problem: `${place.folder} is already a Velloo design — pick another folder.` };
  if (!isEmptyOrMissingSync(place.folder))
    return { place, problem: `${place.folder} isn't empty — pick an empty folder.` };
  const name = body.name?.trim();
  if (name) {
    const issue = designNameIssue(name);
    if (issue) return { place, problem: issue };
    try {
      await chooseDesignName({
        folder: place.folder,
        appRoot: body.appRoot,
        storage: place.managedId
          ? "managed"
          : isWithin(run.launchRoot, place.folder)
            ? "repository"
            : "chosen",
        checkout: run.launchRoot,
        requested: name,
      });
    } catch (err) {
      return { place, problem: (err as Error).message.replace(/ — pick another --name\.$/, ".") };
    }
  }
  return { place };
}

const CONTENT: Record<InitGoal, InitialContent> = {
  // Every start in an app begins with the setup; this is the one that is only that.
  setup: "blank",
  "redesign-screen": "redesign-screen",
  "redesign-component": "component",
  custom: "custom",
  "capture-site": "custom",
  sample: "sample",
  blank: "blank",
};

function captureUrlProblem(url: string): string | undefined {
  try {
    const scheme = new URL(url).protocol;
    return scheme === "http:" || scheme === "https:" ? undefined : "Use an http(s) URL.";
  } catch {
    return "That doesn't look like a URL.";
  }
}

/**
 * The answers the terminal wizard would have produced for the same choices:
 * what the app settles is taken from the reading, and only what it can't —
 * the start, the brief, where the design goes — comes from the page.
 */
export function answersFor(
  body: InitCreateBody,
  reading: AppReading,
  folder: string,
  run: InitRun,
): { answers: WizardAnswers } | { problem: string } {
  const { appRoot } = body;
  const goal = body.goal;
  const text = (value: string | undefined) => value?.trim() || undefined;
  let scanRoot = reading.found ? reading.scanRoot : appRoot;
  let detected = reading.found ? reading.detected : undefined;

  const extra: Partial<WizardAnswers> = {};
  if (goal === "redesign-screen") {
    const route = body.routeId ? reading.routes.find((r) => r.id === body.routeId) : undefined;
    const screenName = route?.name ?? text(body.screenName);
    if (!screenName) return { problem: "Pick one of your app's screens, or name one." };
    extra.screenName = screenName;
    if (route) {
      extra.selectedRoutes = [route];
      // In a repo with several apps, the screen's own app is the one to read.
      if (route.appRel) {
        scanRoot = join(appRoot, route.appRel);
        detected = detectHost(scanRoot, appRoot);
      }
    }
  } else if (goal === "redesign-component") {
    const component = text(body.component);
    if (!component)
      return { problem: "Describe the component so the agent knows what to redesign." };
    extra.componentDescription = component;
  } else if (goal === "custom") {
    const request = text(body.request);
    if (!request) return { problem: "Describe what you want designed." };
    extra.customRequest = request;
  } else if (goal === "capture-site") {
    const url = text(body.captureUrl);
    const problem = url ? captureUrlProblem(url) : "Enter the URL of the site to design from.";
    if (problem || !url) return { problem: problem ?? "Enter a URL." };
    extra.captureUrl = url;
    extra.customRequest = `Recreate the pages I capture from ${url}, then explore alternatives.`;
  }

  const sample = goal === "sample";
  const chosen =
    !reading.found && body.library && isValidLibraryId(body.library) ? body.library : undefined;
  const fromApp = sample
    ? reading.sampleLibrary
    : detected && scanRoot !== reading.scanRoot
      ? libraryForApp(detected).library
      : reading.found
        ? reading.library
        : goal === "blank" || goal === "setup"
          ? "none"
          : reading.library;
  const library: LibraryId = run.pinnedLibrary ?? chosen ?? fromApp;
  const useDesignMd =
    !sample && !run.skipDesignMd && detected?.designMdPath ? body.useDesignMd !== false : undefined;

  return {
    answers: {
      appRoot,
      scanRoot,
      folder,
      library,
      source: WIZARD_PROVIDERS[library].defaultSource,
      componentsRelative: componentsDirFor(appRoot, scanRoot, run.inheritComponentsDir),
      initialContent: CONTENT[goal],
      // Only the sample wears the house theme; a start from the app is neutral
      // until its own theme is found, which `resolveTheme` then prefers.
      themePreset: sample ? DEFAULT_THEME_PRESET : NEUTRAL_THEME_PRESET,
      stack: sample ? DEFAULT_STACK_ID : reading.stack,
      ...(useDesignMd !== undefined ? { useDesignMd } : {}),
      ...(!sample && detected ? { detected } : {}),
      ...extra,
    },
  };
}
