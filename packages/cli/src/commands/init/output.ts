import { join, relative } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import pc from "picocolors";
import {
  BROWSER_PROMPT_DETAIL,
  BROWSER_PROMPT_SIZE,
  installChromiumInteractive,
} from "../../browser-setup.ts";
import {
  completionsInstalled,
  detectShell,
  installCompletions,
} from "../../completions/install.ts";
import type { Scaffold } from "../../scaffold/scaffold.ts";
import { DEFAULT_THEME_PRESET, presetById } from "../../scaffold/theme-presets.ts";
import type { WizardAnswers } from "../../wizard/answers.ts";
import type { InstallPlan } from "../../wizard/provider-registry.ts";
import { stackById } from "../../wizard/stacks.ts";
import type { WireOutcome } from "./agent-wiring.ts";

export function printSummary(
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

export function printExitInstructions(folder: string | undefined, outcome: WireOutcome): void {
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

/**
 * Tell the user where the headless browser is (and isn't) needed, and — when
 * it's missing and we have a TTY — offer to install it up front so the agent's
 * first `screenshot` call doesn't stall on a download.
 */
export async function printScreenshotReadiness(interactive: boolean): Promise<void> {
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
export async function promptShellCompletions(interactive: boolean): Promise<void> {
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
