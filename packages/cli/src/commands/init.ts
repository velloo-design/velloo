import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
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
import { buildDefaultConfig } from "../scaffold/default-config.ts";
import { buildDefaultTheme } from "../scaffold/default-theme.ts";
import {
  buildNoLibBoards,
  buildNoLibScreens,
  buildNoLibSnippets,
} from "../scaffold/nolib-sample.ts";
import { buildSampleBoards, buildSampleScreens } from "../scaffold/sample-page.ts";
import { buildSampleSnippets } from "../scaffold/sample-snippets.ts";
import { buildBoardFromScan, buildScreensFromScan, scanAppRoutes } from "../scan/index.ts";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "../wizard/answers.ts";
import { executeInstall, type InstallPlan } from "../wizard/install.ts";
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

/**
 * Auto-decide whether to run the interactive wizard. Skips when stdin
 * isn't a TTY (CI, piping, scripted invocations) or when the user
 * passes `--non-interactive`. This keeps the existing init smoke test
 * working without changes.
 */
function shouldRunWizard(args: { nonInteractive?: boolean }): boolean {
  if (args.nonInteractive) return false;
  if (!process.stdin.isTTY) return false;
  return true;
}

function isValidLibraryId(v: string): v is LibraryId {
  return v === "shadcn-react" || v === "none" || v === "mui";
}

function isValidSource(v: string): v is LibrarySource {
  return v === "binary" || v === "in-repo" || v === "cache";
}

function isValidContent(v: string): v is InitialContent {
  return v === "sample" || v === "blank" || v === "scan";
}

interface CliArgs {
  folder?: string;
  force?: boolean;
  nonInteractive?: boolean;
  library?: string;
  source?: string;
  appPath?: string;
  componentsDir?: string;
  initialContent?: string;
  themeColor?: string;
  themeVibe?: string;
}

function answersFromArgs(args: CliArgs): WizardAnswers {
  const library: LibraryId = isValidLibraryId(args.library ?? "")
    ? (args.library as LibraryId)
    : "shadcn-react";
  const source: LibrarySource = isValidSource(args.source ?? "")
    ? (args.source as LibrarySource)
    : "binary";
  if (source === "in-repo" && !args.appPath) {
    throw new Error(`velloo init: --source=in-repo requires --app-path=<path-to-your-app>.`);
  }
  return {
    folder: resolve(args.folder ?? "design"),
    library,
    source,
    appPath: args.appPath ? resolve(args.appPath) : undefined,
    componentsRelative: args.componentsDir ?? "src/components/ui",
    initialContent: isValidContent(args.initialContent ?? "")
      ? (args.initialContent as InitialContent)
      : "sample",
    themeColor: args.themeColor && args.themeColor.trim() !== "" ? args.themeColor : undefined,
    themeVibe: args.themeVibe && args.themeVibe.trim() !== "" ? args.themeVibe : undefined,
  };
}

interface Scaffold {
  theme: Theme;
  screens: Screen[];
  boards: Board[];
  snippets: Snippet[];
  annotations: { screenId: string; entries: Annotation[] }[];
  notes: { boardId: string; entries: CanvasNote[] }[];
}

async function buildScaffold(answers: WizardAnswers): Promise<Scaffold> {
  if (answers.initialContent === "blank") {
    const board: Board = {
      id: "main",
      name: "Main",
      frames: [],
      groups: [],
    };
    return {
      theme: buildDefaultTheme(),
      screens: [],
      boards: [board],
      snippets: [],
      annotations: [],
      notes: [],
    };
  }
  if (answers.initialContent === "scan") {
    // Scan-my-app mode generates one screen per detected route. The
    // active provider only matters for the placeholder tree's choice
    // of Badge (shadcn) vs Text (no-lib).
    if (!answers.appPath) {
      throw new Error(
        "--initial-content=scan requires an --app-path (the directory containing package.json).",
      );
    }
    const result = await scanAppRoutes(answers.appPath);
    if (result.routes.length === 0) {
      throw new Error(
        `velloo: no routes detected under ${result.routesRoot}. ` +
          `Velloo looks for Next.js (app/ or pages/), Vite (src/routes/ or src/pages/), and Astro (src/pages/). ` +
          `Either point --app-path at the right folder, or re-run with --initial-content=sample.`,
      );
    }
    const hasBadge = answers.library !== "none";
    const screens = buildScreensFromScan({ routes: result.routes, hasBadge });
    const board = buildBoardFromScan({ screens });
    return {
      theme: buildDefaultTheme(),
      screens,
      boards: [board],
      snippets: [],
      annotations: [],
      notes: [],
    };
  }
  // No-library Pulse doesn't exist (Avatar / Tabs / Accordion / Chart
  // have no no-lib equivalents). Ship a smaller two-screen welcome
  // sample that demonstrates the primitive set instead.
  if (answers.library === "none") {
    return {
      theme: buildDefaultTheme(),
      screens: buildNoLibScreens(),
      boards: buildNoLibBoards(),
      snippets: buildNoLibSnippets(),
      annotations: [],
      notes: [],
    };
  }
  return {
    theme: buildDefaultTheme(),
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
): void {
  const boardLabels = scaffold.boards.map((b) => b.name).join(" + ");
  const sourceLabel =
    answers.source === "binary"
      ? "bundled with velloo"
      : answers.source === "in-repo"
        ? `installed in your app at ${plan.summary.location}`
        : `cached at ${plan.summary.location}`;

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
    console.log(pc.dim("  Blank folder — no screens yet."));
  }
  console.log("");
  console.log(pc.bold("  Your setup"));
  console.log(`    Library     ${plan.summary.name}`);
  console.log(`    Components  ${sourceLabel}`);
  if (answers.source === "in-repo" && answers.appPath) {
    console.log(`    App path    ${answers.appPath}`);
  }
  console.log("");
  console.log(pc.bold("  Next steps"));
  console.log(`    1. ${pc.cyan(`velloo run ${folder}`)}`);
  console.log(`    2. ${pc.cyan("http://localhost:7300")}     ${pc.dim("(canvas)")}`);
  console.log(
    `    3. ${pc.cyan("http://localhost:7301/mcp")} ${pc.dim("(MCP server — point your AI agent here)")}`,
  );
  console.log("");
  console.log(pc.dim("  Open README.md in the design folder for the full guide."));
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
      description: "Target folder for the new design (created if missing)",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Allow scaffolding into a non-empty folder",
    },
    nonInteractive: {
      type: "boolean",
      default: false,
      description: "Skip the wizard and use defaults / flags",
    },
    library: {
      type: "string",
      description: "Component library: shadcn-react | none | mui (default shadcn-react)",
    },
    source: {
      type: "string",
      description: "Where components live: binary | in-repo | cache (default binary)",
    },
    appPath: {
      type: "string",
      description: "Path to your app's root (required when --source=in-repo)",
    },
    componentsDir: {
      type: "string",
      description: "Subfolder inside the app for component sources (default src/components/ui)",
    },
    initialContent: {
      type: "string",
      description: "Initial content: sample | blank (default sample)",
    },
    themeColor: {
      type: "string",
      description: "Hex color for the theme primary",
    },
    themeVibe: {
      type: "string",
      description: "Vibe keyword (calm | playful | professional | energetic)",
    },
  },
  async run({ args }) {
    const cliArgs = args as CliArgs;
    let answers: WizardAnswers;

    if (shouldRunWizard(cliArgs)) {
      printLogo();
      const result = await runInteractive({
        folder: resolve(cliArgs.folder ?? "design"),
      });
      if (!result) {
        process.exit(1);
      }
      answers = result;
    } else {
      try {
        answers = answersFromArgs(cliArgs);
      } catch (err) {
        console.error(`${pc.red("velloo init:")} ${(err as Error).message}`);
        process.exit(1);
      }
    }

    const folder = answers.folder;
    if (!cliArgs.force && !(await isEmptyOrMissing(folder))) {
      console.error(
        `${pc.red("velloo init:")} target folder is not empty: ${folder}\n` +
          `  Pick an empty path, or pass --force to scaffold over it.`,
      );
      process.exit(1);
    }

    const projectId = randomUUID();
    let plan: InstallPlan;
    try {
      plan = await executeInstall(answers, projectId);
    } catch (err) {
      console.error(`${pc.red("velloo init:")} ${(err as Error).message}`);
      process.exit(1);
    }

    let scaffold: Scaffold;
    try {
      scaffold = await buildScaffold(answers);
    } catch (err) {
      console.error(`${pc.red("velloo init:")} ${(err as Error).message}`);
      process.exit(1);
    }
    await writeScaffold(folder, scaffold, plan, answers, projectId);

    // Echo for non-interactive callers that grep the output for
    // "scaffolded" — keeps the existing CLI test passing.
    console.log(`velloo: scaffolded ${folder} (${snapshotVersion})`);
    printSummary(folder, scaffold, plan, answers);
  },
});
