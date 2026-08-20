import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import { CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import {
  type Annotation,
  type Board,
  BoardSchema,
  type CanvasNote,
  ConfigSchema,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import { writeJsonAtomic, writeText } from "@velloo/server";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { defineCommand } from "citty";
import pc from "picocolors";
import { type ConnectResult, connect, PROJECT_AGENT_IDS, pickAgents } from "../connect/index.ts";
import { ensureDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { hasDesignConfig } from "../folder.ts";
import { openUrl } from "../open-url.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { importThemeFromGlobals } from "../scaffold/import-theme.ts";
import {
  buildNoLibBoards,
  buildNoLibScreens,
  buildNoLibSnippets,
} from "../scaffold/nolib-sample.ts";
import { buildSampleBoards, buildSampleScreens } from "../scaffold/sample-page.ts";
import { buildSampleSnippets } from "../scaffold/sample-snippets.ts";
import { buildPresetTheme, presetById } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import {
  buildBoardFromScan,
  buildScreensFromScan,
  resolveScanRoot,
  scanAppRoutes,
} from "../scan/index.ts";
import { dirExists } from "../scan/walk.ts";
import type { WizardAnswers } from "../wizard/answers.ts";
import { answersFromArgs, type InitCliArgs, shouldRunWizard } from "../wizard/args.ts";
import { type InstallPlan, planInstall } from "../wizard/install.ts";
import { printLogo } from "../wizard/logo.ts";
import { runInteractive } from "../wizard/prompts.ts";
import { renderDesignReadme } from "../wizard/readme.ts";

async function isEmptyOrMissing(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

interface Scaffold {
  theme: Theme;
  screens: Screen[];
  boards: Board[];
  snippets: Snippet[];
  annotations: { screenId: string; entries: Annotation[] }[];
  notes: { boardId: string; entries: CanvasNote[] }[];
}

function blankScaffold(theme: Theme): Scaffold {
  return {
    theme,
    screens: [],
    boards: [{ id: "main", name: "Main", frames: [], groups: [] }],
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
  if (answers.initialContent === "scan" && answers.detected?.globalsCssPath) {
    const imported = importThemeFromGlobals(answers.detected.globalsCssPath, answers.themePreset);
    if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
  }
  return { theme: buildPresetTheme(answers.themePreset) };
}

async function buildScaffold(answers: WizardAnswers, theme: Theme): Promise<Scaffold> {
  if (answers.initialContent === "blank") {
    return blankScaffold(theme);
  }

  if (answers.initialContent === "scan") {
    // One screen per chosen route. The interactive wizard pre-filters to the
    // screens the user picked; non-interactive scan uses every detected route.
    // The library only affects the placeholder tree's Badge (shadcn) vs Text
    // (no-lib) choice.
    const routes = answers.selectedRoutes ?? (await scanAppRoutes(answers.scanRoot)).routes;
    if (routes.length === 0) {
      // Don't abort init — fall back to a blank board. init prints why.
      return blankScaffold(theme);
    }
    const hasBadge = answers.library !== "none";
    const screens = buildScreensFromScan({ routes, hasBadge });
    const board = buildBoardFromScan({ screens });
    return { theme, screens, boards: [board], snippets: [], annotations: [], notes: [] };
  }

  // No-library Pulse doesn't exist (Avatar / Tabs / Accordion / Chart
  // have no no-lib equivalents). Ship a smaller two-screen welcome
  // sample that demonstrates the primitive set instead.
  if (answers.library === "none") {
    return {
      theme,
      screens: buildNoLibScreens(),
      boards: buildNoLibBoards(),
      snippets: buildNoLibSnippets(),
      annotations: [],
      notes: [],
    };
  }

  return {
    theme,
    screens: buildSampleScreens(),
    boards: buildSampleBoards(),
    snippets: buildSampleSnippets(),
    annotations: [],
    notes: [],
  };
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
  projectId: string,
): Promise<void> {
  // Point the live-island bundler at the host app. `scanRoot` is the React
  // app root (the app itself, even when nested under a monorepo `appRoot`);
  // store it relative to the design folder, which is how the bundler resolves
  // it (`resolve(folderRoot, hostApp.root)`). Aliases are left to the
  // bundler's `{ "@/*": "*" }` default — reading the host tsconfig per the
  // codebase stance is fragile; apps with a non-root `@` alias edit it once.
  const hostAppRoot = relative(folder, answers.scanRoot);
  const config = buildDefaultConfig({
    library: plan.library,
    projectId,
    defaultScreen: defaultScreenForScaffold(scaffold),
    ...(hostAppRoot ? { hostApp: { root: hostAppRoot } } : {}),
    ...(answers.feedback ? { feedback: answers.feedback } : {}),
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
    : (presetById(answers.themePreset)?.label ?? "Indigo (Pulse default)");

  console.log("");
  console.log(pc.green(`✓ Done. Scaffolded ${folder}.`));
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
      console.log(pc.dim("  Pulse — a sample team-analytics product, ready to remix."));
    }
  } else {
    console.log(pc.dim("  Blank board — no screens yet."));
  }
  console.log("");
  console.log(pc.bold("  Your setup"));
  console.log(`    App root    ${answers.appRoot}`);
  console.log(`    Design      ${folder}`);
  console.log(`    Library     ${plan.summary.name}`);
  console.log(`    Theme       ${themeLabel}`);
  if (plan.pendingUpstream) {
    console.log(
      pc.dim(
        `    (real shadcn lands in ${plan.pendingUpstream.relative} when your agent finishes setup — nothing was written to your app)`,
      ),
    );
  }
}

function printWired(connected: ConnectResult | undefined): void {
  if (!connected || connected.configs.length === 0) return;
  const wired = connected.configs.map((c) => c.agent).join(" + ");
  console.log("");
  console.log(pc.bold("  Agents wired"));
  console.log(
    `    ${pc.green("✓")} ${wired} ${pc.dim(`(MCP config under ${connected.projectRoot})`)}`,
  );
  if (connected.skill?.installed) console.log(pc.dim("    + Claude Code skill"));
  if (connected.cursorRules?.installed) console.log(pc.dim("    + Cursor rule"));
}

function printNextSteps(folder: string, connected: ConnectResult | undefined): void {
  console.log("");
  console.log(pc.bold("  Next steps"));
  let n = 1;
  if (!connected || connected.configs.length === 0) {
    console.log(
      `    ${n++}. ${pc.cyan(`velloo connect ${folder}`)} ${pc.dim("(wire your AI agent's MCP config + guidance)")}`,
    );
  }
  console.log(
    `    ${n++}. Restart your AI agent so it loads the new MCP config ${pc.dim("— it starts velloo itself")}.`,
  );
  console.log(
    `    ${n++}. ${pc.cyan(`velloo run ${folder}`)} ${pc.dim("(optional — open the canvas; it prints the URL)")}`,
  );
  console.log("");
  console.log(pc.dim("  Open README.md in the design folder for the full guide."));
  console.log("");
}

/**
 * Build the copy-paste prompt that gets the user's agent to recreate their app
 * as a Velloo design: a screen per page, boards with mobile + desktop frames,
 * reusable snippets, all verified against the running app via the `screenshot`
 * tool. Init can't screenshot the app itself (it isn't running yet), so the
 * agent — which has the velloo MCP tools and a shell — does the work.
 */
function buildHandoffPrompt(answers: WizardAnswers, screens: Screen[]): string {
  // The agent runs at the app root (its MCP config + skill are wired there),
  // so the app is "this project" and the design folder is just `velloo`. The
  // design is managed entirely through the MCP tools — never edited by hand —
  // so the folder only appears in the `velloo run` command that points the
  // server at it. Keep it relative; fall back to absolute only if it sits
  // outside the app root.
  const rel = relative(answers.appRoot, answers.folder);
  const designDir = rel && !rel.startsWith("..") ? rel : answers.folder;
  const lines = [
    "Build a Velloo design that mirrors this app — reproduce each page's UI as a Velloo screen.",
    `Velloo lives in \`${designDir}/\`. You have the velloo MCP tools (wired during setup) — do everything through them; they own the design, so don't edit files under \`${designDir}/\` by hand. To watch the canvas, run \`velloo run ${designDir}\` — it prints and opens the canvas URL (defaults to :7300, or a free port if that's taken).`,
  ];
  const uiRel = relative(answers.appRoot, answers.scanRoot);
  if (uiRel && !uiRel.startsWith("..")) {
    lines.push(`This app's UI lives in \`${uiRel}/\` — run its dev server from there.`);
  }
  if (screens.length > 0) {
    lines.push(
      `Build only these ${screens.length} screens (each already has a placeholder screen + a board frame), from the project's shadcn components:`,
    );
    for (const s of screens) lines.push(`  - ${s.name || s.id}`);
  } else {
    lines.push(
      "- For each route/page in the app, create a Velloo screen that reproduces that page's UI from the project's shadcn components.",
    );
  }
  lines.push(
    "- Lay the screens out on boards with both mobile and desktop frames.",
    "- Extract repeated UI (nav, headers, cards, footers) into reusable snippets.",
    "- Start the app's dev server and use the velloo `screenshot` tool to compare each screen against the real page; iterate until they match.",
    "- Keep semantic theme tokens (bg-background, text-foreground, …).",
  );
  return lines.join("\n");
}

/**
 * The user's terminal editor: `$VISUAL` / `$EDITOR` (honoring args like
 * `code --wait`) when its binary resolves on PATH, else the first of
 * nano/vim/vi that's installed.
 */
function detectEditor(): string[] {
  const env = (process.env.VISUAL || process.env.EDITOR || "").trim();
  if (env) {
    const parts = env.split(/\s+/);
    if (parts[0] && Bun.which(parts[0])) return parts;
  }
  for (const cand of ["nano", "vim", "vi"]) {
    if (Bun.which(cand)) return [cand];
  }
  return ["vi"];
}

/**
 * Open the handoff prompt in the user's editor and return what they saved
 * (trimmed). Returns null if no editor could be launched. Claude Code has no
 * prefill-without-submit flag, so editing here is how the user shapes the
 * prompt before it's sent.
 */
async function editPrompt(prompt: string): Promise<string | null> {
  const file = join(tmpdir(), `velloo-handoff-${process.pid}-${Date.now()}.md`);
  await writeFile(file, prompt, "utf8");
  const editor = detectEditor();
  try {
    await Bun.spawn([...editor, file], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).exited;
    return (await readFile(file, "utf8")).trim();
  } catch {
    return null;
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * Print the agent handoff (scan only) and — interactively, when `claude` is on
 * PATH — offer to start velloo and launch claude straight into the task.
 */
async function printAgentHandoff(
  answers: WizardAnswers,
  screens: Screen[],
  interactive: boolean,
): Promise<void> {
  if (answers.initialContent !== "scan") return;

  const prompt = buildHandoffPrompt(answers, screens);
  console.log(pc.bold("  Finish setup with your agent"));
  console.log(pc.dim("    Paste this to your AI agent to recreate your app as a Velloo design:"));
  console.log("");
  for (const line of prompt.split("\n")) console.log(pc.cyan(`    ${line}`));
  console.log("");

  if (!interactive || !Bun.which("claude")) return;
  const action = await select<"launch" | "edit" | "skip">({
    message: "Start velloo and launch Claude to do this now?",
    options: [
      { value: "launch", label: "Yes — launch Claude with this prompt" },
      {
        value: "edit",
        label: "Edit the prompt first",
        hint: `opens ${detectEditor()[0] ?? "your editor"}`,
      },
      { value: "skip", label: "No — I'll run it later" },
    ],
    initialValue: "launch",
  });
  if (isCancel(action) || action === "skip") return;

  let finalPrompt = prompt;
  if (action === "edit") {
    const edited = await editPrompt(prompt);
    if (edited === null) {
      console.error("  Couldn't open an editor. Set $EDITOR and retry, or copy the prompt above.");
      return;
    }
    if (edited === "") {
      console.log(pc.dim("  Prompt was emptied — nothing launched."));
      return;
    }
    finalPrompt = edited;
  }

  // Start the persistent canvas so the user can watch; Claude attaches its own
  // `velloo mcp` (wired during init) to the same daemon. The canvas stays up
  // after Claude exits (auto-stops after 5 min idle).
  let canvasUrl: string;
  try {
    const rec = await ensureDaemon(answers.folder);
    canvasUrl = rec.canvasUrl;
  } catch (err) {
    console.error(
      `  Couldn't start the canvas (${(err as Error).message}). ` +
        `Run \`velloo run ${answers.folder}\` yourself, then paste the prompt above.`,
    );
    return;
  }
  console.log(pc.dim(`  velloo canvas at ${canvasUrl}. Launching claude…`));
  await openUrl(canvasUrl);
  await Bun.spawn(["claude", finalPrompt], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).exited;
}

/**
 * Wire the velloo MCP into the user's agents. Interactively, ask which
 * (checkboxes, project Claude Code + Cursor pre-selected, global opt-in);
 * non-interactively, wire the project agents. Returns undefined when skipped.
 */
async function wireAgents(
  folder: string,
  interactive: boolean,
  enabled: boolean,
): Promise<ConnectResult | undefined> {
  if (!enabled) return undefined;
  let agents: string[] = PROJECT_AGENT_IDS;
  if (interactive) {
    const picked = await pickAgents();
    if (picked === null) return undefined;
    agents = picked;
  }
  if (agents.length === 0) return undefined;
  try {
    return await connect({ designFolder: folder, agents, installSkill: true });
  } catch {
    return undefined;
  }
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
      message: "Install the screenshot browser now? (~150MB, one-time)",
      initialValue: false,
    });
    if (!isCancel(proceed) && proceed) {
      const code = await Bun.spawn(["bunx", "playwright", "install", "chromium"], {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      }).exited;
      console.log(
        code === 0
          ? `    ${pc.green("✓")} ${pc.dim("Browser installed.")}`
          : pc.dim(`    Install didn't finish — run it later: ${pc.cyan(CHROMIUM_INSTALL_CMD)}`),
      );
      console.log("");
      return;
    }
  }

  console.log(pc.dim(`    Add it anytime with:  ${pc.cyan(CHROMIUM_INSTALL_CMD)}`));
  console.log("");
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
        "Wire the MCP config + guidance for Claude Code and Cursor (use --no-connect to skip)",
    },
    start: {
      type: "string",
      description: "scratch | scan (scan detects routes + theme from your app)",
    },
    scanDir: {
      type: "string",
      description:
        "Subfolder to scan when your UI isn't at the root (e.g. web/frontend). Auto-detected if omitted.",
    },
    library: {
      type: "string",
      description:
        "Component library: shadcn-upstream | shadcn-react | none | mui (default shadcn-react)",
    },
    componentsDir: {
      type: "string",
      description: "Upstream components subfolder inside your app (default src/components/ui)",
    },
    initialContent: {
      type: "string",
      description: "Initial content: sample | blank (default sample). Use --start=scan to scan.",
    },
    themePreset: {
      type: "string",
      description: "Theme preset: indigo | violet | blue | emerald | rose | orange | amber | zinc",
    },
  },
  async run({ args }) {
    const cliArgs = args as InitCliArgs;
    const appRoot = resolve(cliArgs.folder ?? ".");
    const interactive = shouldRunWizard(cliArgs, Boolean(process.stdin.isTTY));
    let allowNonEmpty = cliArgs.force;

    // An explicit --scan-dir that doesn't exist is a typo, not a degrade-to-blank.
    if (cliArgs.scanDir && !(await dirExists(resolve(appRoot, cliArgs.scanDir)))) {
      fail("init", `--scan-dir "${cliArgs.scanDir}" doesn't exist under ${appRoot}.`);
    }

    // Already a Velloo design here? Don't re-run the whole scaffold wizard —
    // offer the actions that make sense on an existing folder.
    if (interactive && !cliArgs.force) {
      const existing = resolve(appRoot, cliArgs.designFolder ?? "velloo");
      if (await hasDesignConfig(existing)) {
        const action = await select<"connect" | "overwrite" | "cancel">({
          message: `A Velloo design already exists at ${relative(process.cwd(), existing) || existing}. What would you like to do?`,
          options: [
            {
              value: "connect",
              label: "Connect agents",
              hint: "wire the MCP into Claude Code / Cursor",
            },
            {
              value: "overwrite",
              label: "Re-scaffold (overwrite)",
              hint: "replaces the existing design",
            },
            { value: "cancel", label: "Cancel" },
          ],
          initialValue: "connect",
        });
        if (isCancel(action) || action === "cancel") {
          console.log(pc.dim("  Nothing changed."));
          return;
        }
        if (action === "connect") {
          const connected = await wireAgents(existing, true, true);
          printWired(connected);
          printNextSteps(existing, connected);
          return;
        }
        allowNonEmpty = true; // overwrite → fall through to the normal wizard
      }
    }

    let answers: WizardAnswers;

    if (interactive) {
      printLogo();
      console.log(pc.dim(`  App root: ${appRoot}  (where Velloo will be installed)`));
      console.log("");
      const result = await runInteractive({ appRoot, scanDir: cliArgs.scanDir });
      if (!result) {
        // The wizard already printed its cancellation notice.
        process.exit(1);
      }
      answers = result;
    } else {
      try {
        answers = answersFromArgs(cliArgs);
      } catch (err) {
        fail("init", (err as Error).message);
      }
      console.log(`velloo: app root ${answers.appRoot}`);
    }

    // Non-interactive scan still wants the host detection (the wizard fills it
    // for the interactive path) — and the scan root resolution (--scan-dir or
    // auto-discovery of a nested UI folder) the wizard would otherwise do.
    if (answers.initialContent === "scan" && !answers.detected) {
      const { scanRoot, relToApp } = await resolveScanRoot(answers.appRoot, cliArgs.scanDir);
      answers.scanRoot = scanRoot;
      if (relToApp && relToApp !== ".") {
        console.log(pc.dim(`  Scanning UI in ${relToApp} (app root has no package.json).`));
      }
      answers.detected = detectHost(scanRoot);
    }

    const folder = answers.folder;
    if (!allowNonEmpty && !(await isEmptyOrMissing(folder))) {
      fail(
        "init",
        `design folder is not empty: ${folder}\n  Pick an empty path, or pass --force to scaffold over it.`,
      );
    }

    const projectId = randomUUID();
    let plan: InstallPlan;
    try {
      plan = planInstall(answers);
    } catch (err) {
      fail("init", (err as Error).message);
    }

    const { theme, importedFrom } = resolveTheme(answers);
    let scaffold: Scaffold;
    try {
      scaffold = await buildScaffold(answers, theme);
    } catch (err) {
      fail("init", (err as Error).message);
    }
    await writeScaffold(folder, scaffold, plan, answers, projectId);

    // Echo for non-interactive callers that grep the output for
    // "scaffolded" — keeps the existing CLI test passing.
    console.log(`velloo: scaffolded ${folder} (${snapshotVersion})`);
    if (importedFrom) {
      console.log(pc.dim(`  Imported your theme from ${relative(answers.appRoot, importedFrom)}.`));
    }
    if (answers.initialContent === "scan" && scaffold.screens.length === 0) {
      console.log(
        pc.dim("  No routes detected — started you with a blank board instead of a scan."),
      );
    }

    printSummary(folder, scaffold, plan, answers, importedFrom);

    // Ask which agents to wire (interactive) or wire the project defaults, then
    // check the screenshot browser, then hand off to the agent for scans.
    const connected = await wireAgents(folder, interactive, cliArgs.connect !== false);
    printWired(connected);
    await printScreenshotReadiness(interactive);
    await printAgentHandoff(answers, scaffold.screens, interactive);
    printNextSteps(folder, connected);
  },
});
