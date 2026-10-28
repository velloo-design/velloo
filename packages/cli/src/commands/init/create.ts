import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { writeFeedbackContactOk, writeRepoFeedback } from "@velloo/server";
import pc from "picocolors";
import type { AgentWiring } from "../../connect/index.ts";
import { rebaseDesignConfig } from "../../managed-folders.ts";
import { chooseDesignName, isWithin, registerDesign, registerLocalDesign } from "../../manifest.ts";
import type { Scaffold } from "../../scaffold/scaffold.ts";
import { detectHost } from "../../scan/detect.ts";
import { scanApps } from "../../scan/index.ts";
import type { WizardAnswers } from "../../wizard/answers.ts";
import {
  type InstallPlan,
  libraryForApp,
  libraryForSample,
  planInstall,
  scanAdoption,
  WIZARD_PROVIDERS,
} from "../../wizard/provider-registry.ts";
import { applyAgentWiring, NOT_WIRED, type WireOutcome } from "./agent-wiring.ts";
import { displayPath, printSummary, printThemeImport } from "./output.ts";
import { buildScaffold, isEmptyOrMissing, resolveTheme, writeScaffold } from "./scaffold.ts";

/** A reason the design could not be created, worded for the person who asked. */
export class InitError extends Error {}

export interface CreateDesignOptions {
  /** The directory init ran in: its velloo.json lists the design, or this machine records it. */
  launchRoot: string;
  /** Set for Velloo-managed storage, whose folder is named by this id. */
  managedId?: string | undefined;
  /** The design's name, when the person gave one. */
  name?: string | undefined;
  /** An explicit `--library`: the app's own framework does not override it. */
  pinnedLibrary?: boolean | undefined;
  scanDir?: string | undefined;
  /** The answers already carry what the app uses (the wizard read it), so it is not read again. */
  appRead?: boolean | undefined;
  /** Scaffold into a design folder that already has files in it. */
  force?: boolean | undefined;
  /** Agents to wire once the design exists; absent wires none. */
  wiring?: AgentWiring | undefined;
}

export interface CreatedDesign {
  folder: string;
  name: string;
  scaffold: Scaffold;
  /** Recorded on this machine only, never in the repository's velloo.json. */
  local: boolean;
  wireOutcome: WireOutcome;
}

/**
 * Write a design from finished answers: read the app where the answers have
 * not, scaffold the folder, list it, and wire the chosen agents. The browser
 * wizard and the non-interactive flags both end here, so there is one
 * scaffold path. Progress is printed to the terminal; a failure is an
 * {@link InitError} the caller shows where the person is.
 */
export async function createDesign(
  answers: WizardAnswers,
  opts: CreateDesignOptions,
): Promise<CreatedDesign> {
  // Every start that is about the app — blank included, which creates no
  // screens — is built on what the app uses, not on a default: shadcn in a
  // Mantine app, or in one with no UI library at all, is a design made of
  // components the app does not have. The sample reads it for its library
  // alone: it keeps its own theme, composed for the library the app uses.
  const sample = answers.initialContent === "sample";
  const scansRoutes =
    answers.initialContent === "scan" || answers.initialContent === "redesign-screen";
  if (!answers.detected && !opts.appRead) {
    const scanned = await scanApps(answers.appRoot, opts.scanDir);
    const primary = scanned.apps[0];
    // An app with no routes to find is still the app to read.
    const app = primary ?? scanned.roots[0];
    if (app) answers.scanRoot = app.dir;
    if (scansRoutes && scanned.apps.length > 1) {
      console.log(
        pc.dim(
          `  Found ${scanned.apps.length} apps (${scanned.apps.map((a) => a.rel || ".").join(", ")}) — one board per app.`,
        ),
      );
    } else if (scansRoutes && primary?.rel && primary.rel !== ".") {
      console.log(pc.dim(`  Scanning UI in ${primary.rel} (app root has no package.json).`));
    }
    if (scansRoutes && !answers.selectedRoutes) {
      answers.selectedRoutes =
        answers.initialContent === "redesign-screen" ? scanned.routes.slice(0, 1) : scanned.routes;
      if (answers.initialContent === "redesign-screen" && scanned.routes[0]) {
        answers.screenName = answers.screenName ?? scanned.routes[0].name;
      }
    }
    const detected = detectHost(answers.scanRoot, answers.appRoot);
    // The sample keeps its own theme, so what the app is themed with stays unread.
    if (!sample) answers.detected = detected;
    // Adopt the framework the app actually uses so the design renders and
    // emits in it (a MUI app → the MUI adapter). An app no provider claims
    // gets the no-library provider; with no app there is nothing to follow.
    const adopted = opts.pinnedLibrary
      ? undefined
      : app
        ? (sample ? libraryForSample : libraryForApp)(detected)
        : scanAdoption(detected);
    if (adopted) {
      answers.library = adopted.library;
      answers.source = sample ? WIZARD_PROVIDERS[adopted.library].defaultSource : "binary";
      console.log(pc.dim(`  ${adopted.note}`));
    }
  }

  const folder = answers.folder;
  if (!opts.force && !(await isEmptyOrMissing(folder))) {
    throw new InitError(
      `design folder is not empty: ${folder}\n  Pick an empty path, or pass --force to scaffold over it.`,
    );
  }

  let plan: InstallPlan;
  try {
    plan = planInstall(answers);
  } catch (err) {
    throw new InitError((err as Error).message);
  }

  const {
    theme,
    source: themeSource,
    importedFrom,
    importedVia,
    tokenlessStylesheet,
    designMd,
    libraryDefaults,
    fonts,
    fontsFrom,
    leftForSetup,
  } = resolveTheme(answers);
  let scaffold: Scaffold;
  try {
    scaffold = await buildScaffold(answers, theme);
  } catch (err) {
    throw new InitError((err as Error).message);
  }

  // A design outside the checkout — managed storage or a path that lands
  // outside it — is a local design: recorded on this machine, never in the
  // committed velloo.json, which must not point outside its repository.
  const root = opts.launchRoot;
  const managedId = opts.managedId;
  const localId = managedId ?? (isWithin(root, folder) ? undefined : randomUUID());
  let name: string;
  try {
    name = await chooseDesignName({
      folder,
      appRoot: answers.appRoot,
      storage: localId ? (managedId ? "managed" : "chosen") : "repository",
      checkout: root,
      requested: opts.name,
    });
  } catch (err) {
    throw new InitError((err as Error).message);
  }
  let hostStyles: Awaited<ReturnType<typeof writeScaffold>>;
  try {
    hostStyles = await writeScaffold({
      folder,
      scaffold,
      plan,
      answers,
      name,
      local: localId !== undefined,
      ...(designMd ? { designSystemPath: designMd.path } : {}),
      themeSource,
    });
    if (localId) await rebaseDesignConfig(folder, folder, answers.appRoot, true);
  } catch (error) {
    if (localId)
      throw new InitError(
        `Could not finish the design at ${folder}. Existing content was retained. Check write permissions and free disk space before retrying. ${error instanceof Error ? error.message : error}`,
      );
    throw error;
  }

  // Tests and scripts grep the output for "scaffolded".
  console.log(`velloo: scaffolded ${folder} (${plan.library.id} ${plan.library.version})`);
  if (hostStyles) {
    const copied = hostStyles.stored.filter((path) => path.endsWith(".css")).length;
    console.log(
      pc.dim(
        copied > 0
          ? `  Copied ${copied} of the app's stylesheets into the design, so it looks like the app without it running.`
          : "  Found none of the app's stylesheets on disk (built CSS appears once the app is built). Your agent copies them from a captured page with store_host_files.",
      ),
    );
  }

  // Record where the design is so a second one for the same repo stays
  // resolvable. The scaffold already succeeded — a manifest problem is a
  // warning to fix by hand, not a failed init.
  try {
    if (localId) {
      await registerLocalDesign({
        id: localId,
        root,
        appRoot: answers.appRoot,
        ...(managedId ? {} : { designPath: folder }),
      });
      console.log(
        pc.dim(
          `  Recorded as local design "${name}" for ${displayPath(root)} — on this machine only; nothing was added to the repository.`,
        ),
      );
    } else {
      const reg = await registerDesign(folder, root);
      if (reg.created) {
        console.log(
          pc.dim(
            `  Listed design "${reg.name}" in ${relative(process.cwd(), reg.path) || reg.path}.`,
          ),
        );
      }
    }
    // Whether the tool exists is a repo decision, written now that a manifest
    // is guaranteed to exist. Consent to be contacted is the person's and goes
    // to ~/.velloo, never into a committed file.
    if (answers.feedback) {
      await writeRepoFeedback(folder, answers.feedback);
      await writeFeedbackContactOk(answers.feedback.contactOk === true);
    }
  } catch (err) {
    if (localId)
      throw new InitError(
        `Design retained at ${folder}, but registration failed: ${(err as Error).message}`,
      );
    console.log(pc.yellow(`  Couldn't update the repo manifest: ${(err as Error).message}`));
  }
  printThemeImport(answers.appRoot, {
    importedFrom,
    importedVia,
    libraryDefaults,
    fonts,
    fontsFrom,
    leftForSetup,
  });
  if (tokenlessStylesheet) {
    // Not dim: the design is about to open on colors that are not the app's.
    console.log(
      pc.yellow(
        `  Found ${relative(answers.appRoot, tokenlessStylesheet)}, but no theme tokens in it or in the stylesheets it imports — your design starts on a preset instead.`,
      ),
    );
    console.log(
      pc.dim(
        "  Ask your agent to `import_theme` from the file that holds your colors (or `set_theme`, if the app is themed in JavaScript).",
      ),
    );
  }
  if (designMd) {
    const { coverage } = designMd;
    console.log(
      pc.dim(
        `  Read the "${designMd.name}" design system — ${coverage.semantic} of ${coverage.semanticTotal} color roles mapped, ` +
          "and the folder now follows that file (read live, never copied).",
      ),
    );
    if (coverage.semantic < coverage.semanticTotal) {
      console.log(
        pc.dim(
          "  The roles it didn't name kept the preset's colors — ask your agent to `import_theme` from your stylesheet if the canvas looks off.",
        ),
      );
    }
  }
  if (answers.initialContent === "scan" && scaffold.screens.length === 0) {
    console.log(
      pc.dim("  No routes detected — started you with a blank folder instead of a scan."),
    );
  }

  printSummary(folder, scaffold, plan, answers, {
    importedFrom,
    tokenlessStylesheet,
    libraryDefaults,
  });

  const wireOutcome = opts.wiring ? await applyAgentWiring(folder, opts.wiring) : NOT_WIRED;
  return { folder, name, scaffold, local: localId !== undefined, wireOutcome };
}
