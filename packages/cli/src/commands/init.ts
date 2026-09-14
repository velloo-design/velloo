import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { managedDesignPath, writeFeedbackContactOk, writeRepoFeedback } from "@velloo/server";
import { snapshotVersion } from "@velloo/shadcn-snapshot/version";
import { defineCommand } from "citty";
import pc from "picocolors";
import { appRootIsNotAnApp, promptAppRootChoice } from "../app-root.ts";
import { PROJECT_AGENT_IDS } from "../connect/index.ts";
import { fail } from "../fail.ts";
import { checkpoint, rebaseDesignConfig } from "../managed-folders.ts";
import { registerProject } from "../manifest.ts";
import type { Scaffold } from "../scaffold/scaffold.ts";
import { detectHost } from "../scan/detect.ts";
import { scanApps } from "../scan/index.ts";
import { dirExists } from "../scan/walk.ts";
import { offerUpgradeBeforeInit } from "../upgrade-prompt.ts";
import type { WizardAnswers } from "../wizard/answers.ts";
import {
  answersFromArgs,
  type InitCliArgs,
  isValidLibraryId,
  shouldRunWizard,
} from "../wizard/args.ts";
import { printAgentHandoff } from "../wizard/handoff-print.ts";
import { printLogo } from "../wizard/logo.ts";
import { runInteractive } from "../wizard/prompts.ts";
import {
  DEFAULT_LIBRARY_ID,
  type InstallPlan,
  LIBRARY_IDS,
  planInstall,
  scanAdoption,
} from "../wizard/provider-registry.ts";
import { applyAgentWiring, NOT_WIRED, printWired } from "./init/agent-wiring.ts";
import { offerExistingFolderActions } from "./init/existing.ts";
import {
  printExitInstructions,
  printScreenshotReadiness,
  printSummary,
  promptShellCompletions,
} from "./init/output.ts";
import { buildScaffold, isEmptyOrMissing, resolveTheme, writeScaffold } from "./init/scaffold.ts";

export default defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a new Velloo design folder",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Your app root — where Velloo installs (default: current directory)",
    },
    designFolder: {
      type: "string",
      description: "Design folder, relative to the app root (default: velloo)",
    },
    external: {
      type: "boolean",
      description: "Keep the design in Velloo-managed storage outside the application repository",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Allow scaffolding into a non-empty design folder",
    },
    nonInteractive: {
      type: "boolean",
      default: false,
      description: "Skip the wizard and use defaults / flags",
    },
    connect: {
      type: "boolean",
      default: true,
      description:
        "Wire your AI agents' MCP config + guidance — Claude Code / Cursor / Codex / Continue; non-interactive default wires Claude Code + Cursor (use --no-connect to skip)",
    },
    start: {
      type: "string",
      description:
        "Goal: redesign-screen | redesign-component | custom | sample | blank | scan (legacy multi-route)",
    },
    scanDir: {
      type: "string",
      description:
        "Subfolder to scan when your UI isn't at the root (e.g. web/frontend). Auto-detected if omitted.",
    },
    library: {
      type: "string",
      description: `Component library: ${LIBRARY_IDS.join(" | ")} (default ${DEFAULT_LIBRARY_ID})`,
    },
    componentsDir: {
      type: "string",
      description: "Upstream components subfolder inside your app (default src/components/ui)",
    },
    initialContent: {
      type: "string",
      description: "Initial content: sample | blank | redesign-screen | component | custom | scan",
    },
    screenName: {
      type: "string",
      description: "Screen name for --start=redesign-screen (optional if routes are scanned)",
    },
    component: {
      type: "string",
      description: "Component name or description for --start=redesign-component",
    },
    request: {
      type: "string",
      description: "Free-text design request for --start=custom",
    },
    themePreset: {
      type: "string",
      description:
        "Theme preset: elsewhere | indigo | violet | blue | emerald | rose | orange | amber | zinc",
    },
    stack: {
      type: "string",
      description:
        "Your app's stack — sets the emitted import alias: nextjs | vite | astro (@/components/ui) | remix (~/components/ui)",
    },
    project: {
      type: "string",
      description:
        "Project name to register in the repo's velloo.json (default: derived from the folder path)",
    },
  },
  run: ({ args }) => runInit(args as InitCliArgs),
});

/**
 * The init flow, callable outside the command — `velloo folder add` runs
 * exactly this with the design folder already chosen, so there is one
 * scaffold path rather than a second, drifting copy.
 */
export async function runInit(cliArgs: InitCliArgs): Promise<void> {
  let appRoot = resolve(cliArgs.folder ?? ".");
  const interactive = shouldRunWizard(cliArgs, Boolean(process.stdin.isTTY));
  const allowNonEmpty = cliArgs.force;
  // True when the user chose "Create another design folder" — the wizard's
  // folder prompt then defaults to a fresh name instead of the taken one.
  let secondFolder = false;
  let inherited: { library: string | undefined; componentsDir: string | undefined } = {
    library: undefined,
    componentsDir: undefined,
  };

  // An explicit --scan-dir that doesn't exist is a typo, not a degrade-to-blank.
  if (cliArgs.scanDir && !(await dirExists(resolve(appRoot, cliArgs.scanDir)))) {
    fail("init", `--scan-dir "${cliArgs.scanDir}" doesn't exist under ${appRoot}.`);
  }

  // Before anything is scaffolded — and before the logo, so accepting doesn't
  // print it twice across the re-exec: a design folder records the velloo that
  // made it and the skills it installs come from that binary, so upgrading
  // halfway through means doing both again.
  if (interactive && (await offerUpgradeBeforeInit(process.argv.slice(2)))) return;

  if (interactive) printLogo();

  if (interactive && !cliArgs.force && !cliArgs.external) {
    const existing = await offerExistingFolderActions(appRoot, cliArgs);
    if (existing.kind === "handled") return;
    if (existing.kind === "another") {
      secondFolder = true;
      inherited = existing.inherited;
    }
  }

  // The application root is taken from the directory init was run in, and a
  // monorepo root is a directory people run it in — leaving the design bound
  // to a repo root that is not an app at all. Ask only when that is provable:
  // the repo holds UI apps and this directory is not one of them.
  if (interactive && !cliArgs.folder) {
    // A scan hiccup must not block scaffolding: the prompt is a courtesy, and
    // `folder set-app-root` fixes afterwards what this would have prevented.
    const candidates = await appRootIsNotAnApp(appRoot).catch(() => null);
    if (candidates) {
      console.log(
        pc.dim(
          `  ${appRoot} holds ${candidates.length} app${candidates.length === 1 ? "" : "s"} but isn't one itself.`,
        ),
      );
      const chosen = await promptAppRootChoice(appRoot, { currentHint: "this directory" });
      if (chosen) appRoot = chosen;
    }
  }

  let external = cliArgs.external === true;
  let presetFolder = cliArgs.designFolder;
  if (external && cliArgs.designFolder)
    fail("init", "Choose --external or --design-folder, not both.");
  if (interactive && cliArgs.external === undefined && !cliArgs.designFolder) {
    const storage = await select({
      message: "Where should the design live?",
      options: [
        {
          value: "repository",
          label: "Default in repo",
          hint: secondFolder ? "./velloo-brand/" : "./velloo/",
        },
        {
          value: "external",
          label: "Default out of repo",
          hint: "Velloo-managed storage with its own Git history",
        },
        { value: "custom", label: "Custom name", hint: "Choose a design folder name or path" },
      ],
    });
    if (isCancel(storage)) return;
    external = storage === "external";
    if (storage === "repository") presetFolder = secondFolder ? "velloo-brand" : "velloo";
  }
  const managedId = external ? randomUUID() : undefined;
  const managedFolder = managedId ? managedDesignPath(managedId) : undefined;
  let answers: WizardAnswers;

  if (interactive) {
    console.log(pc.dim(`  App root: ${appRoot}  (where Velloo will be installed)`));
    console.log("");
    const inheritedLibrary =
      inherited.library && isValidLibraryId(inherited.library) ? inherited.library : undefined;
    const result = await runInteractive({
      appRoot,
      secondFolder,
      ...(managedFolder || presetFolder ? { presetFolder: managedFolder ?? presetFolder } : {}),
      scanDir: cliArgs.scanDir,
      connectEnabled: cliArgs.connect !== false,
      // An explicit --library still wins over what the sibling folder uses.
      pinnedLibrary:
        cliArgs.library && isValidLibraryId(cliArgs.library) ? cliArgs.library : inheritedLibrary,
      ...(inheritedLibrary && !cliArgs.library
        ? { pinnedLibraryReason: "same as the design folder already in this repo" }
        : {}),
      ...(inherited.componentsDir ? { inheritComponentsDir: inherited.componentsDir } : {}),
    });
    if (result.status === "abort") {
      printExitInstructions(undefined, NOT_WIRED);
      process.exit(1);
    }
    answers = result.answers;
  } else {
    try {
      answers = answersFromArgs(cliArgs);
    } catch (err) {
      fail("init", (err as Error).message);
    }
    console.log(`velloo: app root ${answers.appRoot}`);
  }

  // Non-interactive scan / redesign still wants host detection.
  if (
    (answers.initialContent === "scan" || answers.initialContent === "redesign-screen") &&
    !answers.detected
  ) {
    const scanned = await scanApps(answers.appRoot, cliArgs.scanDir);
    const primary = scanned.apps[0];
    if (primary) answers.scanRoot = primary.dir;
    if (scanned.apps.length > 1) {
      console.log(
        pc.dim(
          `  Found ${scanned.apps.length} apps (${scanned.apps.map((a) => a.rel || ".").join(", ")}) — one board per app.`,
        ),
      );
    } else if (primary?.rel && primary.rel !== ".") {
      console.log(pc.dim(`  Scanning UI in ${primary.rel} (app root has no package.json).`));
    }
    answers.selectedRoutes =
      answers.initialContent === "redesign-screen" ? scanned.routes.slice(0, 1) : scanned.routes;
    answers.agentPicksFirst = answers.initialContent === "scan";
    if (answers.initialContent === "redesign-screen" && scanned.routes[0]) {
      answers.screenName = answers.screenName ?? scanned.routes[0].name;
    }
    answers.detected = detectHost(answers.scanRoot);
    // The "existing project" flow: when the user didn't pin a library, adopt
    // the framework the app actually uses so the scan renders + emits in the
    // host's framework (a MUI app → the MUI adapter), not a default mismatch.
    // Which provider claims what — including the unsupported-framework
    // (Chakra/Mantine/…) → no-framework fallback — lives in the registry.
    const adopted = cliArgs.library ? undefined : scanAdoption(answers.detected);
    if (adopted) {
      answers.library = adopted.library;
      answers.source = "binary";
      console.log(pc.dim(`  ${adopted.note}`));
    }
  }

  if (managedFolder) answers.folder = managedFolder;
  const folder = answers.folder;
  if (!allowNonEmpty && !(await isEmptyOrMissing(folder))) {
    fail(
      "init",
      `design folder is not empty: ${folder}\n  Pick an empty path, or pass --force to scaffold over it.`,
    );
  }

  let plan: InstallPlan;
  try {
    plan = planInstall(answers);
  } catch (err) {
    fail("init", (err as Error).message);
  }

  // The wizard's last prompt otherwise cuts straight to silence while the
  // theme import + scaffold writes run — say what's happening.
  if (interactive) console.log(pc.dim("  Scaffolding your design folder…"));

  const { theme, importedFrom } = resolveTheme(answers);
  let scaffold: Scaffold;
  try {
    scaffold = await buildScaffold(answers, theme);
  } catch (err) {
    fail("init", (err as Error).message);
  }
  try {
    await writeScaffold(folder, scaffold, plan, answers);
    if (managedId) {
      await rebaseDesignConfig(folder, folder, answers.appRoot, true);
      await checkpoint(folder, "Initial Velloo design", true);
    }
  } catch (error) {
    if (managedId)
      throw new Error(
        `Could not finish the managed design at ${folder}. Existing content was retained. Check Git, write permissions and free disk space before retrying. ${error instanceof Error ? error.message : error}`,
      );
    throw error;
  }

  // Echo for non-interactive callers that grep the output for
  // "scaffolded" — keeps the existing CLI test passing.
  console.log(`velloo: scaffolded ${folder} (${snapshotVersion})`);

  // Name the folder in the repo manifest so a second design folder in the
  // same repo stays resolvable. The scaffold already succeeded — a manifest
  // problem is a warning to fix by hand, not a failed init.
  try {
    const reg = await registerProject(folder, answers.appRoot, cliArgs.project, managedId);
    if (reg.created) {
      console.log(
        pc.dim(
          `  Registered as project "${reg.name}" in ${relative(process.cwd(), reg.path) || reg.path}.`,
        ),
      );
    }
    // Whether the tool exists is a repo decision, written now that a manifest
    // is guaranteed to exist (a folder outside any repo has nowhere higher to
    // put it and keeps the default, off). Consent to be contacted is the
    // person's and goes to ~/.velloo, never into a committed file.
    if (answers.feedback) {
      await writeRepoFeedback(folder, answers.feedback);
      await writeFeedbackContactOk(answers.feedback.contactOk === true);
    }
  } catch (err) {
    if (managedId)
      fail(
        "init",
        `Design retained at ${folder}, but registration failed: ${(err as Error).message}`,
      );
    console.log(pc.yellow(`  Couldn't update the repo manifest: ${(err as Error).message}`));
  }
  if (importedFrom) {
    console.log(pc.dim(`  Imported your theme from ${relative(answers.appRoot, importedFrom)}.`));
  }
  if (answers.initialContent === "scan" && scaffold.screens.length === 0) {
    console.log(
      pc.dim("  No routes detected — started you with a blank folder instead of a scan."),
    );
  }

  printSummary(folder, scaffold, plan, answers, importedFrom);

  // Apply the wiring chosen in the wizard (or the project defaults when
  // non-interactive), then check the screenshot browser, then hand off to
  // the agent for scans.
  let wireOutcome = NOT_WIRED;
  if (cliArgs.connect !== false) {
    const wiring = interactive
      ? answers.agentWiring
      : { agents: PROJECT_AGENT_IDS, manual: false, preWired: [] };
    if (wiring) wireOutcome = await applyAgentWiring(folder, wiring);
  }
  printWired(wireOutcome);
  await printScreenshotReadiness(interactive);
  await promptShellCompletions(interactive);
  await printAgentHandoff(answers, scaffold, interactive, wireOutcome.wiredIds);
  printExitInstructions(folder, wireOutcome);
}
