import type { WizardAnswers } from "./answers.ts";
import { type InstallPlan, WIZARD_PROVIDERS } from "./provider-registry.ts";

/**
 * Render the per-folder README dropped at `<folder>/README.md` during
 * init (the folder defaults to `velloo/`). Tailored to the chosen library
 * so the agent's first `list_components` description has provider-correct
 * context, and the human's `cd <folder>` lands on a guide that matches the
 * install they actually picked.
 */
export function renderDesignReadme(answers: WizardAnswers, plan: InstallPlan): string {
  const lines: string[] = [];
  lines.push("# Velloo design folder");
  lines.push("");
  lines.push("This folder is a Velloo design — pure JSON describing screens,");
  lines.push("boards, snippets, and a theme. Velloo renders these with real");
  lines.push(`React components from a pinned **${plan.summary.name}** snapshot.`);
  lines.push("");
  lines.push("## Quick start");
  lines.push("");
  lines.push("```bash");
  lines.push("velloo run .");
  lines.push("```");
  lines.push("");
  lines.push("`velloo run .` prints and opens the canvas URL — it defaults to");
  lines.push("http://localhost:7300, but uses a free port if that's taken. Your AI");
  lines.push("agent drives the design over MCP — wire it once with `velloo connect`,");
  lines.push("and it starts the velloo MCP server itself (no separate server to run).");
  lines.push("");
  lines.push("## Your setup");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Library | ${plan.summary.name} |`);
  lines.push(`| Components | ${plan.summary.location} |`);
  lines.push(`| App root | ${answers.appRoot} |`);
  const surfaceLabel =
    answers.productSurface && answers.productSurface !== "saas"
      ? ` (${answers.productSurface} slice)`
      : "";
  const contentLabel =
    answers.initialContent === "sample"
      ? `Pulse sample${surfaceLabel}`
      : answers.initialContent === "scan"
        ? "scanned from your app"
        : "blank";
  lines.push(`| Initial content | ${contentLabel} |`);
  lines.push("");
  lines.push("## Layout");
  lines.push("");
  lines.push("```");
  lines.push(".design/config.json        tool + library declaration");
  lines.push("theme/default.json         color tokens (OKLCH)");
  lines.push("screens/<id>.json          one composition each (light + dark)");
  lines.push("boards/<id>.json           frame layouts on the canvas");
  lines.push("snippets/<id>.json         reusable subtrees with typed params");
  lines.push("assets/                    generated SVGs / images");
  lines.push("```");
  lines.push("");

  lines.push(...WIZARD_PROVIDERS[answers.library].readmeComponentsSection(plan));

  lines.push("## What the AI agent sees");
  lines.push("");
  lines.push("Velloo exposes ~55 MCP tools — discovery (`list_screens`, `list_components`,");
  lines.push("`list_snippets`, `get_theme`), tree mutations (`add_node`, `update_props`,");
  lines.push("`set_style`, `move_node`, …), snippets, theme operations (`set_token`,");
  lines.push("`apply_preset`, `derive_palette_from_color`), inspection");
  lines.push("(`inspect`, `audit`, `screenshot`, `validate_classes`), and");
  lines.push("code emission (`emit_code`, `emit_snippet`, `emit_theme`).");
  lines.push("");
  lines.push("Designs are static by construction — click handlers, routing, and forms");
  lines.push("are no-ops in the canvas. The agent reads the design and writes real");
  lines.push("code into your app via `emit_code`.");
  lines.push("");
  return lines.join("\n");
}
