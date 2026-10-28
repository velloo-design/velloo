import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { managedDesignPath } from "@velloo/server";
import { defineCommand } from "citty";
import pc from "picocolors";
import { PROJECT_AGENT_IDS } from "../connect/index.ts";
import { fail } from "../fail.ts";
import { dirExists } from "../scan/walk.ts";
import { offerUpgradeBeforeInit } from "../upgrade-prompt.ts";
import { hasAppToMatch, type WizardAnswers } from "../wizard/answers.ts";
import { answersFromArgs, type InitCliArgs, shouldRunWizard } from "../wizard/args.ts";
import { wantsHandoff } from "../wizard/handoff.ts";
import { printAgentHandoff } from "../wizard/handoff-print.ts";
import { DEFAULT_LIBRARY_ID, LIBRARY_IDS } from "../wizard/provider-registry.ts";
import { printWired } from "./init/agent-wiring.ts";
import { runBrowserInit } from "./init/browser.ts";
import { type CreatedDesign, createDesign, InitError } from "./init/create.ts";
import { printExitInstructions, printScreenshotReadiness } from "./init/output.ts";

export default defineCommand({
  meta: {
    name: "init",
    description: "Set up a Velloo design — opens a setup page in your browser",
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
      description: "Skip the browser setup page and use defaults / flags",
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
    designMd: {
      type: "boolean",
      default: true,
      description:
        "Seed the theme from a DESIGN.md found at the app or repo root (use --no-design-md to keep the stylesheet / preset)",
    },
    stack: {
      type: "string",
      description:
        "Your app's stack — sets the emitted import alias: nextjs | vite | astro (@/components/ui) | remix (~/components/ui)",
    },
    name: {
      type: "string",
      description: "The design's name (default: derived from its folder, or the app it designs)",
    },
  },
  run: ({ args }) => runInit(args as InitCliArgs),
});

/**
 * The init flow, callable outside the command — `velloo design add` runs
 * exactly this with the design folder already chosen, so there is one
 * scaffold path rather than a second, drifting copy. In a terminal the
 * questions are asked in the browser; otherwise the flags answer them.
 */
export async function runInit(cliArgs: InitCliArgs): Promise<void> {
  const appRoot = resolve(cliArgs.folder ?? ".");
  const interactive = shouldRunWizard(cliArgs, Boolean(process.stdin.isTTY));

  // An explicit --scan-dir that doesn't exist is a typo, not a degrade-to-blank.
  if (cliArgs.scanDir && !(await dirExists(resolve(appRoot, cliArgs.scanDir)))) {
    fail("init", `--scan-dir "${cliArgs.scanDir}" doesn't exist under ${appRoot}.`);
  }
  if (cliArgs.external && cliArgs.designFolder)
    fail("init", "Choose --external or --design-folder, not both.");

  if (interactive) {
    // Before anything is scaffolded: a design folder records the velloo that
    // made it and the skills it installs come from that binary, so upgrading
    // halfway through means doing both again.
    if (await offerUpgradeBeforeInit(process.argv.slice(2))) return;
    await runBrowserInit(cliArgs);
    return;
  }

  let answers: WizardAnswers;
  try {
    answers = answersFromArgs(cliArgs);
  } catch (err) {
    fail("init", (err as Error).message);
  }
  console.log(`velloo: app root ${answers.appRoot}`);

  const managedId = cliArgs.external ? randomUUID() : undefined;
  if (managedId) answers.folder = managedDesignPath(managedId);
  let created: CreatedDesign;
  try {
    created = await createDesign(answers, {
      launchRoot: appRoot,
      managedId,
      name: cliArgs.name,
      pinnedLibrary: Boolean(cliArgs.library),
      scanDir: cliArgs.scanDir,
      force: cliArgs.force,
      // The default wires project configs, which a local design never writes;
      // editing someone's global agent config unasked is not a default either,
      // so it waits for an explicit `velloo connect`.
      wiring:
        cliArgs.connect === false || managedId
          ? undefined
          : { agents: PROJECT_AGENT_IDS, manual: false, preWired: [] },
    });
  } catch (err) {
    if (err instanceof InitError) fail("init", err.message);
    throw err;
  }
  const { folder, scaffold, wireOutcome } = created;
  if (created.local && cliArgs.connect !== false)
    console.log(
      pc.dim("  Agents not wired: a local design uses global configs — run `velloo connect`."),
    );
  printWired(wireOutcome);
  await printScreenshotReadiness();
  printAgentHandoff(answers, scaffold);
  printExitInstructions(folder, wireOutcome, {
    setup: hasAppToMatch(answers),
    handoff: wantsHandoff(answers),
  });
}
