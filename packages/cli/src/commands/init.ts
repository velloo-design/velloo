import { mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import {
  BoardSchema,
  ConfigSchema,
  type HostApp,
  ScreenSchema,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import {
  writeFeedbackContactOk,
  writeJsonAtomic,
  writeRepoFeedback,
  writeText,
} from "@velloo/server";
import { snapshotVersion } from "@velloo/shadcn-snapshot/version";
import { defineCommand } from "citty";
import pc from "picocolors";
import {
  BROWSER_PROMPT_DETAIL,
  BROWSER_PROMPT_SIZE,
  installChromiumInteractive,
} from "../browser-setup.ts";
import { completionsInstalled, detectShell, installCompletions } from "../completions/install.ts";
import {
  type AgentWiring,
  askAgentWiring,
  type ConnectResult,
  connect,
  manualSetupText,
  PROJECT_AGENT_IDS,
} from "../connect/index.ts";
import { resolveProjectRoot } from "../connect/project-root.ts";
import {
  inheritedFromFolder,
  promptExistingFolderAction,
  readFolderFacts,
  runCheckSetup,
  runOpenCanvas,
  runScan,
  runThemeReimport,
  runUpgrade,
} from "../existing-folder.ts";
import { fail } from "../fail.ts";
import { existingDesignFolder, hasDesignConfig } from "../folder.ts";
import { registerProject } from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import {
  componentScaffold,
  customRequestScaffold,
  redesignScreenScaffold,
} from "../scaffold/goal-scaffolds.ts";
import { findMuiTheme, importThemeFromMui } from "../scaffold/import-mui-theme.ts";
import { importThemeFromGlobals } from "../scaffold/import-theme.ts";
import type { Scaffold } from "../scaffold/scaffold.ts";
import { buildPresetTheme, DEFAULT_THEME_PRESET, presetById } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import {
  appPrefixes,
  buildBoardsFromScan,
  buildScreensFromScan,
  scanAppRoutes,
  scanApps,
} from "../scan/index.ts";
import { dirExists } from "../scan/walk.ts";
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
  sampleScaffold,
  scanAdoption,
  WIZARD_PROVIDERS,
} from "../wizard/provider-registry.ts";
import { renderDesignReadme } from "../wizard/readme.ts";
import { stackById } from "../wizard/stacks.ts";

async function isEmptyOrMissing(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

function blankScaffold(theme: Theme): Scaffold {
  return {
    theme,
    screens: [],
    boards: [],
    snippets: [],
    annotations: [],
    notes: [],
  };
}

/**
 * The scaffold's theme: for scan we import the host app's globals.css so the
 * canvas renders in their brand; everything else uses the chosen preset.
 */
function resolveTheme(answers: WizardAnswers): { theme: Theme; importedFrom?: string } {
  // Prefer the host app's theme whenever detection found one (scan, redesign,
  // component after auto-adopt, etc.).
  if (answers.detected) {
    if (answers.detected.uiLibrary === "mui") {
      const themeFile = findMuiTheme(answers.scanRoot);
      if (themeFile) {
        const imported = importThemeFromMui(themeFile, answers.themePreset);
        if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
      }
    }
    if (answers.detected.globalsCssPath) {
      const imported = importThemeFromGlobals(answers.detected.globalsCssPath, answers.themePreset);
      if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
    }
  }
  // Blank defaults to zinc (neutral) so the folder isn't opinionated until the
  // agent or user styles it. An explicit --theme-preset wins either way.
  if (answers.initialContent === "blank") {
    return { theme: buildPresetTheme(answers.themePreset ?? "zinc") };
  }
  return { theme: buildPresetTheme(answers.themePreset ?? DEFAULT_THEME_PRESET) };
}

async function buildScaffold(answers: WizardAnswers, theme: Theme): Promise<Scaffold> {
  if (answers.initialContent === "blank") {
    return blankScaffold(theme);
  }
  if (answers.initialContent === "component") {
    return componentScaffold(theme, answers.componentDescription ?? "Component");
  }
  if (answers.initialContent === "custom") {
    return customRequestScaffold(theme);
  }
  if (answers.initialContent === "redesign-screen") {
    if (answers.selectedRoutes && answers.selectedRoutes.length > 0) {
      const routes = answers.selectedRoutes;
      const screens = buildScreensFromScan({
        routes,
        ...WIZARD_PROVIDERS[answers.library].scanScreenOpts,
      });
      const boards = buildBoardsFromScan({ routes });
      return { theme, screens, boards, snippets: [], annotations: [], notes: [] };
    }
    return redesignScreenScaffold(theme, answers.screenName ?? "Screen");
  }

  if (answers.initialContent === "scan") {
    // Legacy multi-route scan (non-interactive --start=scan).
    const routes = answers.selectedRoutes ?? (await scanAppRoutes(answers.scanRoot)).routes;
    if (routes.length === 0) {
      return blankScaffold(theme);
    }
    const screens = buildScreensFromScan({
      routes,
      ...WIZARD_PROVIDERS[answers.library].scanScreenOpts,
    });
    const boards = buildBoardsFromScan({ routes });
    return { theme, screens, boards, snippets: [], annotations: [], notes: [] };
  }

  // The provider's own welcome sample, or the shadcn welcome sample default.
  return sampleScaffold(answers, theme);
}

function defaultScreenForScaffold(scaffold: Scaffold): string | undefined {
  if (scaffold.screens.find((s) => s.id === "landing")) return "landing";
  return scaffold.screens[0]?.id;
}

async function writeScaffold(
  folder: string,
  scaffold: Scaffold,
  plan: InstallPlan,
  answers: WizardAnswers,
): Promise<void> {
  // Point the live-island bundler at the host app. `scanRoot` is the primary
  // app root (the app itself, even when nested under a monorepo `appRoot`);
  // store it relative to the design folder, which is how the bundler resolves
  // it (`resolve(folderRoot, hostApp.root)`). Aliases are left to the
  // bundler's `{ "@/*": "*" }` default — reading the host tsconfig per the
  // codebase stance is fragile; apps with a non-root `@` alias edit it once.
  const hostAppRoot = relative(folder, answers.scanRoot);
  // A multi-app scan also registers every route-bearing app under
  // `config.hostApps`, keyed by the same prefixes the screen ids use, so a
  // live extension can target its app via `extension.app`.
  const appRels = [
    ...new Set((answers.selectedRoutes ?? []).map((r) => r.appRel).filter(Boolean)),
  ] as string[];
  let hostApps: Record<string, HostApp> | undefined;
  if (appRels.length > 1) {
    const prefixes = appPrefixes(appRels);
    hostApps = {};
    for (const rel of appRels) {
      const key = prefixes.get(rel);
      if (key) hostApps[key] = { root: relative(folder, resolve(answers.appRoot, rel)) };
    }
  }
  // CSS framework (the styling axis): only the no-framework library has a real
  // choice — shadcn carries Tailwind and MUI carries `sx` intrinsically. Each
  // provider's registry entry decides.
  const styling = WIZARD_PROVIDERS[answers.library].stylingFor(answers);
  // The stack prompt's one output: emit_code mentions imports under the
  // alias the user's app actually resolves.
  const stack = stackById(answers.stack);
  const config = buildDefaultConfig({
    library: plan.library,
    defaultScreen: defaultScreenForScaffold(scaffold),
    ...(hostAppRoot ? { hostApp: { root: hostAppRoot } } : {}),
    ...(hostApps ? { hostApps } : {}),

    ...(styling ? { styling } : {}),
    codegen: {
      ...(stack ? { componentsAlias: stack.alias } : {}),
      componentsDir: answers.componentsRelative,
    },
  });
  ConfigSchema.parse(config);
  ThemeSchema.parse(scaffold.theme);
  for (const screen of scaffold.screens) ScreenSchema.parse(screen);
  for (const board of scaffold.boards) BoardSchema.parse(board);
  for (const snippet of scaffold.snippets) SnippetSchema.parse(snippet);

  // Ensure the standard layout exists even on blank inits, so the
  // canvas + watcher have predictable parents and `readdir` calls
  // (in tests or downstream tools) succeed.
  await Promise.all([
    mkdir(`${folder}/screens`, { recursive: true }),
    mkdir(`${folder}/boards`, { recursive: true }),
    mkdir(`${folder}/snippets`, { recursive: true }),
  ]);

  // `.design/cache/` is daemon runtime state (lockfiles, logs — recreated on
  // demand) and `.velloo/` holds trace tapes; both are local and regenerated,
  // so they're ignored rather than tracked. The cache dir no longer needs a
  // committed `.gitkeep` — the daemon mkdirs it on startup.
  const gitignore = [
    "# Velloo runtime + debug artifacts — regenerated on demand, never commit.",
    ".design/cache/",
    ".velloo/",
    "",
  ].join("\n");
  const writes: Promise<unknown>[] = [
    writeJsonAtomic(`${folder}/.design/config.json`, config),
    writeJsonAtomic(`${folder}/theme/default.json`, scaffold.theme),
    writeText(`${folder}/.gitignore`, gitignore),
    writeText(`${folder}/assets/.gitkeep`, ""),
    writeText(`${folder}/README.md`, renderDesignReadme(answers, plan)),
  ];
  for (const s of scaffold.screens) {
    writes.push(writeJsonAtomic(`${folder}/screens/${s.id}.json`, s));
  }
  for (const b of scaffold.boards) {
    writes.push(writeJsonAtomic(`${folder}/boards/${b.id}.json`, b));
  }
  for (const s of scaffold.snippets) {
    writes.push(writeJsonAtomic(`${folder}/snippets/${s.id}.json`, s));
  }
  await Promise.all(writes);
}

function printSummary(
  folder: string,
  scaffold: Scaffold,
  plan: InstallPlan,
  answers: WizardAnswers,
  importedFrom: string | undefined,
): void {
  const boardLabels = scaffold.boards.map((b) => b.name).join(" + ");
  const themeLabel = importedFrom
    ? `imported from ${relative(answers.appRoot, importedFrom) || importedFrom}`
    : (presetById(answers.themePreset ?? DEFAULT_THEME_PRESET)?.label ?? "Indigo");

  console.log("");
  console.log(pc.green("✓ Velloo is installed and ready to use."));
  console.log(pc.dim(`  Scaffolded ${folder}`));
  console.log("");
  if (scaffold.screens.length > 0) {
    console.log(
      `  ${pc.bold(boardLabels)} — ${scaffold.screens.length} screens across ${scaffold.boards.length} board${scaffold.boards.length === 1 ? "" : "s"}.`,
    );
    const names = scaffold.screens.map((s) => s.name || s.id);
    const shown = names.slice(0, 8);
    const more = names.length - shown.length;
    console.log(pc.dim(`    ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`));
    if (answers.initialContent === "sample") {
      console.log(pc.dim("  Welcome sample — ready to remix."));
    }
  } else {
    console.log(pc.dim("  Blank — no boards or screens yet."));
  }
  console.log("");
  console.log(pc.bold("  Your setup"));
  console.log(`    App root    ${answers.appRoot}`);
  console.log(`    Design      ${folder}`);
  console.log(`    Library     ${plan.summary.name}`);
  console.log(`    Theme       ${themeLabel}`);
  const stack = stackById(answers.stack);
  if (stack) console.log(`    Stack       ${stack.label} (imports via ${stack.alias})`);
  if (plan.pendingUpstream) {
    console.log(
      pc.dim(
        `    (real shadcn lands in ${plan.pendingUpstream.relative} when your agent finishes setup — nothing was written to your app)`,
      ),
    );
  }
}

/**
 * How init's agent-wiring step ended: what was written this run, plus every
 * agent id known to carry velloo for this project (pre-existing global wires
 * included) — the launch offers downstream must only name wired agents.
 */
interface WireOutcome {
  connected?: ConnectResult;
  wiredIds: string[];
}

const NOT_WIRED: WireOutcome = { wiredIds: [] };

function printWired(outcome: WireOutcome): void {
  const connected = outcome.connected;
  if (!connected || connected.configs.length === 0) return;
  const wired = connected.configs.map((c) => c.agent).join(" + ");
  console.log("");
  console.log(pc.bold("  Agents wired"));
  console.log(
    `    ${pc.green("✓")} ${wired} ${pc.dim(`(MCP config under ${connected.projectRoot})`)}`,
  );
  if (connected.plugin)
    console.log(pc.dim("    + Claude Code plugin (skills · commands · subagents)"));
  if (connected.skills?.length)
    console.log(
      pc.dim(
        `    + ${connected.skills.length} agent skill${connected.skills.length === 1 ? "" : "s"} (.agents/skills)`,
      ),
    );
  if (connected.geminiExtension)
    console.log(
      pc.dim(
        `    + Gemini extension${connected.geminiExtension.linked ? "" : ` (link it: gemini extensions link ${connected.geminiExtension.dir})`}`,
      ),
    );
  if (connected.cursorRules?.installed) console.log(pc.dim("    + Cursor rule"));
}

function printExitInstructions(folder: string | undefined, outcome: WireOutcome): void {
  console.log("");
  console.log(pc.bold("  How to use velloo"));
  let n = 1;
  if (folder) {
    if (outcome.wiredIds.length === 0) {
      console.log(
        `    ${n++}. ${pc.cyan(`velloo connect ${folder}`)} ${pc.dim("(wire your AI agent's MCP config + guidance)")}`,
      );
    }
    console.log(
      `    ${n++}. Reload MCP in your AI agent (or restart it) so it loads the new config ${pc.dim("— it starts velloo itself")}.`,
    );
    console.log(
      `    ${n++}. ${pc.cyan("velloo run")} ${pc.dim("(opens the canvas; o open, b background, q stop)")}`,
    );
    console.log("");
    const readme = join(relative(process.cwd(), folder) || ".", "README.md");
    console.log(`  ${pc.dim("Open")} ${pc.cyan(readme)} ${pc.dim("for the full guide.")}`);
  } else {
    console.log(
      `    ${n++}. ${pc.cyan("velloo init")} ${pc.dim("again when you're ready to scaffold a design folder")}`,
    );
    console.log(
      `    ${n++}. ${pc.cyan("velloo run <folder>")} ${pc.dim("opens the canvas for an existing design")}`,
    );
    console.log(
      `    ${n++}. ${pc.cyan("velloo connect <folder>")} ${pc.dim("wires your AI agent's MCP config")}`,
    );
  }
  console.log("");
}

/** @deprecated alias — prefer printExitInstructions */
function printNextSteps(folder: string, outcome: WireOutcome): void {
  printExitInstructions(folder, outcome);
}

/**
 * Apply agent-wiring choices: write the MCP configs + guidance, print the
 * manual instructions if asked. The interactive *questions* live in the
 * wizard (`askAgentWiring`, asked before any file exists); this is the
 * write side, run only after the scaffold landed.
 */
async function applyAgentWiring(folder: string, wiring: AgentWiring): Promise<WireOutcome> {
  let result: ConnectResult | undefined;
  if (wiring.agents.length > 0) {
    try {
      result = await connect({ designFolder: folder, agents: wiring.agents, installSkill: true });
    } catch {
      result = undefined;
    }
  }
  if (wiring.manual) {
    console.log("");
    console.log(pc.bold("  Manual MCP setup"));
    for (const line of manualSetupText().split("\n")) console.log(`  ${line}`);
  }
  return {
    connected: result,
    wiredIds: [...wiring.preWired, ...(result?.configs.map((c) => c.agent) ?? [])],
  };
}

/**
 * Tell the user where the headless browser is (and isn't) needed, and — when
 * it's missing and we have a TTY — offer to install it up front so the agent's
 * first `screenshot` call doesn't stall on a download.
 */
async function printScreenshotReadiness(interactive: boolean): Promise<void> {
  const installed = (await chromiumExecutable()) !== null;
  console.log(pc.bold("  Screenshots"));
  console.log(
    pc.dim("    Your agent's `screenshot` tool and `velloo render --to=png` use a headless"),
  );
  console.log(pc.dim("    browser. The canvas, editing, and `velloo publish` don't need it."));

  if (installed) {
    console.log(`    ${pc.green("✓")} ${pc.dim("Browser installed — screenshots are ready.")}`);
    console.log("");
    return;
  }

  if (interactive) {
    const proceed = await confirm({
      message: `Install the screenshot browser now? ${BROWSER_PROMPT_SIZE}\n${BROWSER_PROMPT_DETAIL}`,
      initialValue: false,
    });
    if (!isCancel(proceed) && proceed) {
      const ok = await installChromiumInteractive();
      console.log(
        ok
          ? `    ${pc.green("✓")} ${pc.dim("Browser installed — screenshots are ready.")}`
          : pc.dim(
              `    Screenshots aren't ready yet — fix per the messages above, or retry later: ${pc.cyan(CHROMIUM_INSTALL_CMD)}`,
            ),
      );
      console.log("");
      return;
    }
  }

  console.log(pc.dim(`    Add it anytime with:  ${pc.cyan(CHROMIUM_INSTALL_CMD)}`));
  console.log("");
}

/**
 * Offer shell TAB completion for `velloo` — once. Skipped silently when the
 * shell is unsupported/undetected or completions are already installed, so
 * repeat inits don't nag.
 */
async function promptShellCompletions(interactive: boolean): Promise<void> {
  if (!interactive) return;
  const shell = detectShell();
  if (!shell || completionsInstalled(undefined, shell)) return;
  const proceed = await confirm({
    message: `Install shell completions now? (TAB completion for velloo commands in ${shell})`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) {
    console.log(pc.dim(`  Anytime later:  ${pc.cyan("velloo completions --install")}`));
    return;
  }
  try {
    const r = await installCompletions(shell);
    console.log(
      `  ${pc.green("✓")} ${shell} completions installed ${pc.dim(
        shell === "fish"
          ? "— new fish sessions pick them up."
          : `— restart your shell (or \`source ${r.rcPath}\`).`,
      )}`,
    );
  } catch (err) {
    console.log(
      pc.dim(
        `  Couldn't install completions (${(err as Error).message}) — try \`velloo completions --install\` later.`,
      ),
    );
  }
}

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
      description: "Theme preset: indigo | violet | blue | emerald | rose | orange | amber | zinc",
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
  const appRoot = resolve(cliArgs.folder ?? ".");
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

  if (interactive) printLogo();

  // Already a Velloo design here? Don't re-run the whole scaffold wizard —
  // offer the actions that make sense on an existing folder.
  if (interactive && !cliArgs.force) {
    // With --add-folder the design-folder arg names the folder being *created*,
    // so the sibling to read defaults from is whichever one the repo already
    // has — not that path.
    const existing = cliArgs.addFolder
      ? ((await existingDesignFolder(appRoot)) ?? resolve(appRoot, "velloo"))
      : resolve(appRoot, cliArgs.designFolder ?? "velloo");
    if (await hasDesignConfig(existing)) {
      const facts = await readFolderFacts(existing, appRoot);
      // `velloo folder add` skips the menu — the caller already said what they
      // came for.
      const action = cliArgs.addFolder
        ? "another"
        : await promptExistingFolderAction(facts, existing);
      if (action === null || action === "cancel") {
        console.log(pc.dim("  Nothing changed."));
        return;
      }
      if (action === "connect") {
        const wiring = await askAgentWiring({
          skipWhenCovered: true,
          projectRoot: await resolveProjectRoot(existing),
        });
        const wireOutcome = wiring ? await applyAgentWiring(existing, wiring) : NOT_WIRED;
        printWired(wireOutcome);
        printNextSteps(existing, wireOutcome);
        return;
      }
      if (action !== "another") {
        if (action === "upgrade") await runUpgrade(existing);
        if (action === "scan") await runScan(existing, appRoot, cliArgs.scanDir);
        if (action === "theme") await runThemeReimport(existing, appRoot);
        if (action === "check") await runCheckSetup(existing, appRoot);
        if (action === "open") await runOpenCanvas(existing);
        return;
      }
      // "another" falls through to the normal wizard, which asks where the
      // new folder goes — and rejects a path that's already a design folder
      // at the prompt, not after the whole wizard has run. The app is the
      // same one, so the sibling's library + components dir carry over
      // instead of being asked again.
      secondFolder = true;
      inherited = await inheritedFromFolder(existing);
    }
  }

  let answers: WizardAnswers;

  if (interactive) {
    console.log(pc.dim(`  App root: ${appRoot}  (where Velloo will be installed)`));
    console.log("");
    const inheritedLibrary =
      inherited.library && isValidLibraryId(inherited.library) ? inherited.library : undefined;
    const result = await runInteractive({
      appRoot,
      secondFolder,
      ...(cliArgs.addFolder && cliArgs.designFolder ? { presetFolder: cliArgs.designFolder } : {}),
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
  await writeScaffold(folder, scaffold, plan, answers);

  // Echo for non-interactive callers that grep the output for
  // "scaffolded" — keeps the existing CLI test passing.
  console.log(`velloo: scaffolded ${folder} (${snapshotVersion})`);

  // Name the folder in the repo manifest so a second design folder in the
  // same repo stays resolvable. The scaffold already succeeded — a manifest
  // problem is a warning to fix by hand, not a failed init.
  try {
    const reg = await registerProject(folder, answers.appRoot, cliArgs.project);
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
