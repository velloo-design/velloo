import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import pc from "picocolors";
import type { Scaffold } from "../../scaffold/scaffold.ts";
import { presetById } from "../../scaffold/theme-presets.ts";
import type { WizardAnswers } from "../../wizard/answers.ts";
import { type InstallPlan, WIZARD_PROVIDERS } from "../../wizard/provider-registry.ts";
import { stackById } from "../../wizard/stacks.ts";
import type { WireOutcome } from "./agent-wiring.ts";
import { themePresetFor } from "./scaffold.ts";

/** An absolute path as a person reads it: `~/…` under the home directory. */
export function displayPath(path: string): string {
  const home = homedir();
  const rel = relative(home, path);
  if (rel === "") return "~";
  return rel.startsWith("..") || isAbsolute(rel) ? path : `~${sep}${rel}`;
}

export function printSummary(
  folder: string,
  scaffold: Scaffold,
  plan: InstallPlan,
  answers: WizardAnswers,
  themeSource: {
    importedFrom?: string | undefined;
    tokenlessStylesheet?: string | undefined;
    libraryDefaults?: string | undefined;
  },
): void {
  const boardLabels = scaffold.boards.map((b) => b.name).join(" + ");
  const { importedFrom, tokenlessStylesheet, libraryDefaults } = themeSource;
  const presetLabel = presetById(themePresetFor(answers))?.label ?? themePresetFor(answers);
  const themeLabel = importedFrom
    ? `imported from ${relative(answers.appRoot, importedFrom) || importedFrom}`
    : libraryDefaults
      ? `${libraryDefaults}'s default theme`
      : tokenlessStylesheet
        ? `${presetLabel} preset — no tokens found in ${relative(answers.appRoot, tokenlessStylesheet) || tokenlessStylesheet}`
        : presetLabel;

  console.log("");
  console.log(pc.green("✓ Velloo is installed and ready to use."));
  console.log(pc.dim(`  Scaffolded ${displayPath(folder)}`));
  console.log("");
  if (scaffold.screens.length > 0) {
    const screens = scaffold.screens.length;
    const boards = scaffold.boards.length;
    console.log(
      `  ${pc.bold(boardLabels)} — ${screens} screen${screens === 1 ? "" : "s"} across ${boards} board${boards === 1 ? "" : "s"}.`,
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
  const stack =
    WIZARD_PROVIDERS[answers.library].usesStack === false ? undefined : stackById(answers.stack);
  // The alias is where shadcn's components are imported from; nothing else reads it.
  if (stack)
    console.log(
      `    Stack       ${stack.label}${plan.pendingUpstream ? ` (imports via ${stack.alias})` : ""}`,
    );
  if (plan.pendingUpstream) {
    console.log(
      pc.dim(
        `    (real shadcn lands in ${plan.pendingUpstream.relative} when your agent finishes setup — nothing was written to your app)`,
      ),
    );
  }
}

/**
 * What the theme import read and what it left, said as it happened: where the
 * theme came from — the app's own files, or the library's defaults when the
 * app sets none — then the fonts it set and what setup still has to settle.
 * The last two hold whichever way the theme was found.
 */
export function printThemeImport(
  appRoot: string,
  found: {
    importedFrom?: string | undefined;
    importedVia?: string[] | undefined;
    libraryDefaults?: string | undefined;
    fonts?: string[] | undefined;
    fontsFrom?: string | undefined;
    leftForSetup?: string[] | undefined;
  },
): void {
  const { importedFrom, libraryDefaults, fonts, fontsFrom, leftForSetup } = found;
  if (importedFrom) {
    const via = (found.importedVia ?? []).map((path) => relative(appRoot, path));
    console.log(
      pc.dim(
        `  Imported your theme from ${relative(appRoot, importedFrom)}${via.length > 0 ? ` and the stylesheets it imports (${via.join(", ")})` : ""}.`,
      ),
    );
  }
  if (libraryDefaults) {
    console.log(
      pc.dim(
        `  Your app sets no ${libraryDefaults} theme, so the design starts on ${libraryDefaults}'s own — the colours, corners and fonts its components already have.`,
      ),
    );
  }
  if (!importedFrom && !libraryDefaults) return;
  if (fonts && fonts.length > 0) {
    console.log(
      pc.dim(
        `  Fonts: ${[...new Set(fonts)].join(", ")} — from ${fontsFrom ?? "your app's font loader"}.`,
      ),
    );
  }
  // Said now, so the canvas is not taken for a finished match: setup is where these are settled.
  if (leftForSetup && leftForSetup.length > 0) {
    // The import names things the way an agent reads them; a person wants the gist.
    const prefix = "tailwind.config theme.extend.";
    const settings = leftForSetup
      .filter((what) => what.startsWith(prefix))
      .map((what) => what.slice(prefix.length).split(" ")[0]);
    const rest = leftForSetup
      .filter((what) => !what.startsWith(prefix))
      .map((what) => what.replace(/`/g, ""));
    const parts = [
      ...rest,
      ...(settings.length > 0
        ? [
            `${settings.length} Tailwind setting${settings.length > 1 ? "s" : ""} with no theme token (${settings.join(", ")})`,
          ]
        : []),
    ];
    console.log(pc.dim(`  Left for setup: ${parts.join("; ")}.`));
  }
}

export function printExitInstructions(
  folder: string | undefined,
  outcome: WireOutcome,
  opts: { setup?: boolean; handoff?: boolean } = {},
): void {
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
    if (opts.handoff) {
      // The prompt printed above already opens with the setup; say it once.
      console.log(
        `    ${n++}. Give your agent ${pc.bold("the prompt above")}${opts.setup ? pc.dim(" — it sets Velloo up for this app first, then starts on the design") : ""}.`,
      );
    } else if (opts.setup) {
      console.log(
        `    ${n++}. Ask your agent to ${pc.bold("set Velloo up for this app")} — ${pc.cyan("/velloo:setup")} in Claude Code, or say it in any agent.`,
      );
      console.log(
        pc.dim(
          "       It matches your theme and fonts, checks that your components render, and proposes",
        ),
      );
      console.log(pc.dim("       your design language for you to review on the canvas."));
    }
    console.log(
      `    ${n++}. ${pc.cyan("velloo run")} ${pc.dim("(opens the canvas; o open, b background, q stop)")}`,
    );
    console.log("");
    // A design outside the working directory (managed storage) reads better
    // absolute than as a climb of `../`.
    const rel = relative(process.cwd(), folder);
    const readme = join(rel.startsWith("..") ? displayPath(folder) : rel || ".", "README.md");
    console.log(`  ${pc.dim("Open")} ${pc.cyan(readme)} ${pc.dim("for the full guide.")}`);
  } else {
    console.log(
      `    ${n++}. ${pc.cyan("velloo init")} ${pc.dim("again when you're ready to scaffold a design folder")}`,
    );
    console.log(
      `    ${n++}. ${pc.cyan("velloo run <design>")} ${pc.dim("opens the canvas for an existing design")}`,
    );
    console.log(
      `    ${n++}. ${pc.cyan("velloo connect <design>")} ${pc.dim("wires your AI agent's MCP config")}`,
    );
  }
  console.log("");
}

/**
 * Tell the user where the headless browser is (and isn't) needed, and how to
 * install it up front so the agent's first `screenshot` doesn't stall on a
 * download.
 */
export async function printScreenshotReadiness(): Promise<void> {
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

  console.log(pc.dim(`    Add it anytime with:  ${pc.cyan(CHROMIUM_INSTALL_CMD)}`));
  console.log("");
}
