import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
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
import { fail } from "../fail.ts";
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
import { buildBoardFromScan, buildScreensFromScan, scanAppRoutes } from "../scan/index.ts";
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
    // One screen per detected route. The library only affects the
    // placeholder tree's Badge (shadcn) vs Text (no-lib) choice.
    const result = await scanAppRoutes(answers.appRoot);
    if (result.routes.length === 0) {
      // Don't abort init — fall back to a blank board. init prints why.
      return blankScaffold(theme);
    }
    const hasBadge = answers.library !== "none";
    const screens = buildScreensFromScan({ routes: result.routes, hasBadge });
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
  const config = buildDefaultConfig({
    library: plan.library,
    projectId,
    defaultScreen: defaultScreenForScaffold(scaffold),
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

  const writes: Promise<unknown>[] = [
    writeJsonAtomic(`${folder}/.design/config.json`, config),
    writeJsonAtomic(`${folder}/theme/default.json`, scaffold.theme),
    writeText(`${folder}/.design/cache/.gitkeep`, ""),
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
  console.log("");
  console.log(pc.bold("  Next steps"));
  console.log(
    `    1. ${pc.cyan(`velloo connect ${folder}`)} ${pc.dim("(wire your AI agent's MCP config + skill)")}`,
  );
  console.log(`    2. ${pc.cyan(`velloo run ${folder}`)}`);
  console.log(`    3. ${pc.cyan("http://localhost:7300")}     ${pc.dim("(canvas)")}`);
  console.log(
    `    4. ${pc.cyan("http://localhost:7301/mcp")} ${pc.dim("(MCP server — your agent connects here)")}`,
  );
  console.log("");
  console.log(pc.dim("  Open README.md in the design folder for the full guide."));
  console.log("");
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
    start: {
      type: "string",
      description: "scratch | scan (scan detects routes + theme from your app)",
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
    let answers: WizardAnswers;

    if (interactive) {
      printLogo();
      console.log(pc.dim(`  App root: ${appRoot}  (where Velloo will be installed)`));
      console.log("");
      const result = await runInteractive({ appRoot });
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
    // for the interactive path).
    if (answers.initialContent === "scan" && !answers.detected) {
      answers.detected = detectHost(answers.appRoot);
    }

    const folder = answers.folder;
    if (!cliArgs.force && !(await isEmptyOrMissing(folder))) {
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
    await printScreenshotReadiness(interactive);
  },
});
