import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import { CHROMIUM_INSTALL_ARGV, CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import {
  type Annotation,
  type Board,
  BoardSchema,
  type CanvasNote,
  type Config,
  ConfigSchema,
  type HostApp,
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
import { completionsInstalled, detectShell, installCompletions } from "../completions/install.ts";
import {
  AGENTS,
  type ConnectResult,
  connect,
  detectInstalledAgents,
  GLOBAL_AGENT_IDS,
  globallyWiredAgents,
  MANUAL_AGENT_ID,
  manualSetupText,
  PROJECT_AGENT_IDS,
  pickAgents,
} from "../connect/index.ts";
import { ensureDaemon } from "../daemon/runtime.ts";
import { fail } from "../fail.ts";
import { hasDesignConfig } from "../folder.ts";
import { openUrl } from "../open-url.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { findMuiTheme, importThemeFromMui } from "../scaffold/import-mui-theme.ts";
import { importThemeFromGlobals } from "../scaffold/import-theme.ts";
import { buildMuiBoards, buildMuiScreens, buildMuiSnippets } from "../scaffold/mui-sample.ts";
import {
  buildNoLibBoards,
  buildNoLibScreens,
  buildNoLibSnippets,
} from "../scaffold/nolib-sample.ts";
import { buildSampleBoards, buildSampleScreens } from "../scaffold/sample-page.ts";
import { buildSampleSnippets } from "../scaffold/sample-snippets.ts";
import { buildPresetTheme, presetById } from "../scaffold/theme-presets.ts";
import { buildVibeTheme, vibeById } from "../scaffold/vibes.ts";
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
import { answersFromArgs, type InitCliArgs, shouldRunWizard } from "../wizard/args.ts";
import { buildHandoffPrompt, expandHandoffPrompt, SCREENS_PLACEHOLDER } from "../wizard/handoff.ts";
import { type InstallPlan, planInstall } from "../wizard/install.ts";
import { printLogo } from "../wizard/logo.ts";
import { runInteractive } from "../wizard/prompts.ts";
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
  if (answers.initialContent === "scan") {
    // A MUI app's theme lives in a `createTheme({...})` module, not globals.css —
    // read that first when scanning a MUI host.
    if (answers.detected?.uiLibrary === "mui") {
      const themeFile = findMuiTheme(answers.scanRoot);
      if (themeFile) {
        const imported = importThemeFromMui(themeFile, answers.themePreset);
        if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
      }
    }
    if (answers.detected?.globalsCssPath) {
      const imported = importThemeFromGlobals(answers.detected.globalsCssPath, answers.themePreset);
      if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
    }
  }
  if (answers.themeVibe) return { theme: buildVibeTheme(answers.themeVibe) };
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
    const screens = buildScreensFromScan({ routes, hasBadge, mui: answers.library === "mui" });
    const boards = buildBoardsFromScan({ routes });
    return { theme, screens, boards, snippets: [], annotations: [], notes: [] };
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

  // Pulse isn't ported to MUI (its shadcn composition would need a full
  // redesign). Ship a two-screen MUI welcome sample (sx styling) instead.
  if (answers.library === "mui") {
    return {
      theme,
      screens: buildMuiScreens(),
      boards: buildMuiBoards(),
      snippets: buildMuiSnippets(),
      annotations: [],
      notes: [],
    };
  }

  return {
    theme,
    screens: buildSampleScreens(answers.productSurface),
    boards: buildSampleBoards(answers.productSurface),
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
  // choice — shadcn carries Tailwind and MUI carries `sx` intrinsically. For a
  // `none` folder, detect Tailwind in the host (config/dep) ⇒ "tailwind",
  // otherwise ⇒ "none" (inline styles, no build step).
  const styling: Config["styling"] =
    plan.library.id === "none"
      ? { framework: answers.detected?.tailwindMajor ? "tailwind" : "none" }
      : undefined;
  // The stack prompt's one output: emit_code mentions imports under the
  // alias the user's app actually resolves.
  const stack = stackById(answers.stack);
  const config = buildDefaultConfig({
    library: plan.library,
    defaultScreen: defaultScreenForScaffold(scaffold),
    ...(hostAppRoot ? { hostApp: { root: hostAppRoot } } : {}),
    ...(hostApps ? { hostApps } : {}),
    ...(answers.feedback ? { feedback: answers.feedback } : {}),
    ...(styling ? { styling } : {}),
    ...(stack ? { codegen: { componentsAlias: stack.alias } } : {}),
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
  const vibe = vibeById(answers.themeVibe);
  const themeLabel = importedFrom
    ? `imported from ${relative(answers.appRoot, importedFrom) || importedFrom}`
    : vibe
      ? `${vibe.label} vibe (${vibe.description})`
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

function printNextSteps(folder: string, outcome: WireOutcome): void {
  console.log("");
  console.log(pc.bold("  Next steps"));
  let n = 1;
  if (outcome.wiredIds.length === 0) {
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
 * Agent CLIs the handoff step can launch straight into the task. Only agents
 * velloo can also wire (see connect/agents.ts) belong here — launching an
 * agent that can't carry the velloo MCP hands the user a tool-less session.
 * `agentIds` ties each launcher to its wiring targets: a launcher is offered
 * only when installed AND one of those ids actually got (or already was) wired.
 */
const AGENT_LAUNCHERS = [
  {
    bin: "claude",
    label: "Claude Code",
    agentIds: ["claude-code", "claude-code-global"],
    argv: (p: string) => ["claude", p],
  },
  {
    bin: "cursor-agent",
    label: "Cursor CLI",
    agentIds: ["cursor", "cursor-global"],
    argv: (p: string) => ["cursor-agent", p],
  },
  {
    bin: "codex",
    label: "Codex CLI",
    agentIds: ["codex", "codex-global"],
    argv: (p: string) => ["codex", p],
  },
  {
    bin: "opencode",
    label: "opencode",
    agentIds: ["opencode", "opencode-global"],
    argv: (p: string) => ["opencode", "--prompt", p],
  },
  {
    bin: "droid",
    label: "Droid",
    agentIds: ["droid-global"],
    argv: (p: string) => ["droid", p],
  },
  {
    bin: "cline",
    label: "Cline",
    agentIds: ["cline-global"],
    argv: (p: string) => ["cline", p],
  },
  {
    bin: "gemini",
    label: "Gemini CLI",
    agentIds: ["gemini", "gemini-global"],
    argv: (p: string) => ["gemini", "-i", p],
  },
] as const;
type AgentLauncher = (typeof AGENT_LAUNCHERS)[number];

/** Best-effort clipboard write via the platform's native CLI. */
async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: string[][] =
    process.platform === "darwin"
      ? [["pbcopy"]]
      : process.platform === "win32"
        ? [["clip"]]
        : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const argv of candidates) {
    const bin = argv[0];
    if (!bin || !Bun.which(bin)) continue;
    const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    await proc.stdin.end();
    if ((await proc.exited) === 0) return true;
  }
  return false;
}

/**
 * Print the agent handoff (scan only) and — interactively — offer to start
 * velloo and launch a wired, installed agent CLI straight into the task, or
 * copy the prompt for any other agent. Launch options are limited to agents
 * that actually carry the velloo MCP (`wiredIds`): launching an unwired agent
 * hands the user a tool-less session. After the user picks an agent, they
 * choose whether to open the canvas in the browser — watching the design
 * build is half the demo, but the agent's MCP-approval prompt lands in the
 * terminal, so it stays an explicit opt-in rather than an automatic yank.
 */
async function printAgentHandoff(
  answers: WizardAnswers,
  scaffold: Scaffold,
  interactive: boolean,
  wiredIds: string[],
): Promise<void> {
  if (answers.initialContent !== "scan") return;

  const { screens } = scaffold;
  const prompt = buildHandoffPrompt(answers, screens, scaffold.boards);
  console.log(pc.bold("  Finish setup with your agent"));
  console.log(pc.dim("    Paste this to your AI agent to recreate your app as a Velloo design:"));
  console.log("");
  for (const line of prompt.split("\n")) console.log(pc.cyan(`    ${line}`));
  if (prompt.includes(SCREENS_PLACEHOLDER)) {
    console.log("");
    console.log(
      pc.dim(
        `    ${SCREENS_PLACEHOLDER} is replaced with your ${screens.length} selected screens when the prompt is sent (an agent can also discover them with list_screens).`,
      ),
    );
  }
  console.log("");

  if (!interactive) return;
  const launchers = AGENT_LAUNCHERS.filter(
    (l) => Bun.which(l.bin) && l.agentIds.some((id) => wiredIds.includes(id)),
  );
  const first = launchers[0];
  const action = await select<string>({
    message: first
      ? "Start velloo and launch your agent to do this now?"
      : "No wired agent CLI to launch — what next?",
    options: [
      ...launchers.map((l) => ({
        value: `launch:${l.bin}`,
        label: `Yes — launch ${l.label} with this prompt`,
      })),
      ...(first
        ? [
            {
              value: "edit",
              label: "Edit the prompt first",
              hint: `opens ${detectEditor()[0] ?? "your editor"}`,
            },
          ]
        : []),
      { value: "copy", label: "Copy the prompt to my clipboard" },
      { value: "skip", label: first ? "No — I'll run it later" : "Skip" },
    ],
    initialValue: first ? `launch:${first.bin}` : "copy",
  });
  if (isCancel(action) || action === "skip") return;

  if (action === "copy") {
    const copied = await copyToClipboard(expandHandoffPrompt(prompt, screens));
    console.log(
      copied
        ? `  ${pc.green("✓")} Prompt copied — paste it into your agent.`
        : pc.dim("  Couldn't reach a clipboard tool — copy the prompt printed above."),
    );
    return;
  }

  let finalPrompt = prompt;
  let launcher: AgentLauncher | undefined = first;
  if (action.startsWith("launch:")) {
    launcher = launchers.find((l) => `launch:${l.bin}` === action);
  } else {
    // action === "edit"
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
    if (launchers.length > 1) {
      const pick = await select<string>({
        message: "Launch which agent?",
        options: launchers.map((l) => ({ value: l.bin, label: l.label })),
        initialValue: launchers[0]?.bin,
      });
      if (isCancel(pick)) return;
      launcher = launchers.find((l) => l.bin === pick);
    }
  }
  if (!launcher) return;

  // The user reads + edits the compact placeholder form; the agent gets the
  // real screen list.
  finalPrompt = expandHandoffPrompt(finalPrompt, screens);

  // Start the persistent canvas so it's ready to watch; the agent attaches its
  // own `velloo mcp` (wired during init) to the same daemon. The canvas stays
  // up after the agent exits (auto-stops after 5 min idle).
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
  // Watching the agent design on the board is the best first-run demo — offer
  // it, but warn that the approval prompt is about to land in THIS terminal.
  const openCanvas = await confirm({
    message: `Open the board in your browser to watch? (${launcher.label} will still ask for MCP approval here first)`,
    initialValue: true,
  });
  if (!isCancel(openCanvas) && openCanvas) await openUrl(canvasUrl);
  console.log("");
  console.log(`  Canvas running at ${pc.cyan(canvasUrl)}.`);
  console.log(
    pc.dim(
      `  Launching ${launcher.label} here — it may ask you to approve the velloo MCP server first.`,
    ),
  );
  await Bun.spawn(launcher.argv(finalPrompt), {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).exited;
}

/**
 * Wire the velloo MCP into the user's agents. Interactively, ask which
 * (checkboxes; the agents detected on this machine are pre-selected — one
 * global wire covers every project). Global configs that already carry velloo
 * are noted and hidden from the list; the question is skipped only when every
 * DETECTED agent is covered — a lone wired Codex must not silently leave an
 * installed Claude Code unwired (the agent handoff would then launch a claude
 * without velloo). Non-interactively, wire the project agents.
 */
async function wireAgents(
  folder: string,
  interactive: boolean,
  enabled: boolean,
): Promise<WireOutcome> {
  if (!enabled) return NOT_WIRED;
  let agents: string[] = PROJECT_AGENT_IDS;
  let manual = false;
  let wired: string[] = [];
  if (interactive) {
    wired = await globallyWiredAgents();
    const detected = detectInstalledAgents();
    const wanted = detected.length > 0 ? detected : GLOBAL_AGENT_IDS;
    const missing = wanted.filter((id) => !wired.includes(id));
    if (wired.length > 0) {
      const labels = wired.map((id) => AGENTS[id]?.label ?? id).join(", ");
      console.log("");
      if (missing.length === 0) {
        console.log(
          `  ${pc.green("✓")} velloo is already wired globally — ${labels} ${pc.dim("(covers this project; skipping agent setup)")}`,
        );
        return { wiredIds: wired };
      }
      console.log(
        `  ${pc.green("✓")} Already wired globally: ${labels} ${pc.dim("(covers this project)")}`,
      );
    }
    const picked = await pickAgents({ exclude: wired, initial: missing });
    if (picked === null) return { wiredIds: wired };
    manual = picked.includes(MANUAL_AGENT_ID);
    agents = picked.filter((id) => id !== MANUAL_AGENT_ID);
  }
  let result: ConnectResult | undefined;
  if (agents.length > 0) {
    try {
      result = await connect({ designFolder: folder, agents, installSkill: true });
    } catch {
      result = undefined;
    }
  }
  if (manual) {
    console.log("");
    console.log(pc.bold("  Manual MCP setup"));
    for (const line of manualSetupText().split("\n")) console.log(`  ${line}`);
  }
  return {
    connected: result,
    wiredIds: [...wired, ...(result?.configs.map((c) => c.agent) ?? [])],
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
      message: "Install the screenshot browser now? (~150MB, one-time)",
      initialValue: false,
    });
    if (!isCancel(proceed) && proceed) {
      const code = await Bun.spawn([...CHROMIUM_INSTALL_ARGV], {
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
    surface: {
      type: "string",
      description:
        "Pulse slice for the shadcn sample: saas (all of it) | analytics (App board) | marketing (Marketing board)",
    },
    themePreset: {
      type: "string",
      description: "Theme preset: indigo | violet | blue | emerald | rose | orange | amber | zinc",
    },
    vibe: {
      type: "string",
      description:
        "Theme by feel: playful | calm | natural | bold | minimal | premium | techy | soft | cozy | sunny | moody | fresh",
    },
    stack: {
      type: "string",
      description:
        "Your app's stack — sets the emitted import alias: nextjs | vite | astro (@/components/ui) | remix (~/components/ui)",
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
          const wireOutcome = await wireAgents(existing, true, true);
          printWired(wireOutcome);
          printNextSteps(existing, wireOutcome);
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
    // for the interactive path) — and the app discovery (--scan-dir, a nested
    // UI folder, or a monorepo's several apps) the wizard would otherwise do.
    if (answers.initialContent === "scan" && !answers.detected) {
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
      answers.selectedRoutes = scanned.routes;
      answers.agentPicksFirst = true;
      answers.detected = detectHost(answers.scanRoot);
      // The "existing project" flow: when the user didn't pin a library, adopt
      // the framework the app actually uses so the scan renders + emits in the
      // host's framework (a MUI app → the MUI adapter), not a default mismatch.
      // An unsupported framework (Chakra/Mantine/…) → the no-framework adapter:
      // the agent approximates with div-backed primitives + preserves real
      // imports via $emitAs.
      if (!cliArgs.library && answers.detected.uiLibrary) {
        answers.library = answers.detected.uiLibrary === "mui" ? "mui" : "shadcn-react";
        answers.source = "binary";
        console.log(pc.dim(`  Detected ${answers.detected.uiLibrary} — using that library.`));
      } else if (!cliArgs.library && answers.detected.unsupportedUi) {
        answers.library = "none";
        answers.source = "binary";
        console.log(
          pc.dim(
            `  Detected ${answers.detected.unsupportedUi} (no velloo adapter yet) — using the no-framework adapter; approximate its components and preserve their imports with emit-as.`,
          ),
        );
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
    const wireOutcome = await wireAgents(folder, interactive, cliArgs.connect !== false);
    printWired(wireOutcome);
    await printScreenshotReadiness(interactive);
    await promptShellCompletions(interactive);
    await printAgentHandoff(answers, scaffold, interactive, wireOutcome.wiredIds);
    printNextSteps(folder, wireOutcome);
  },
});
