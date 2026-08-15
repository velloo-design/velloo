import type { WizardAnswers } from "./answers.ts";
import type { InstallPlan } from "./install.ts";

/**
 * Render the per-folder README dropped at `./design/README.md` during
 * init. Tailored to the chosen library so the agent's first
 * `list_components` description has provider-correct context, and the
 * human's `cd design` lands on a guide that matches the install they
 * actually picked.
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
  lines.push("Open http://localhost:7300 for the canvas. The MCP server lives");
  lines.push("at http://localhost:7301/mcp — point your AI agent there to drive");
  lines.push("the design via tool calls.");
  lines.push("");
  lines.push("## Your setup");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Library | ${plan.summary.name} |`);
  lines.push(`| Components | ${plan.summary.location} |`);
  if (answers.source === "in-repo" && answers.appPath) {
    lines.push(`| App path | ${answers.appPath} |`);
  }
  lines.push(
    `| Initial content | ${answers.initialContent === "sample" ? "Pulse sample" : "blank"} |`,
  );
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

  if (answers.source === "in-repo") {
    lines.push("## Working with your app");
    lines.push("");
    lines.push("The shadcn snapshot was installed into your app at");
    lines.push(`\`${plan.summary.location}\`. You can:`);
    lines.push("");
    lines.push('- `import { Button } from "@/components/ui/button"` from your app code');
    lines.push("  exactly like vanilla shadcn — the snapshot files are real source.");
    lines.push("- Run `npx shadcn add <component>` later on the same folder to pull in");
    lines.push("  more upstream components; Velloo's renderer doesn't read them yet, but");
    lines.push("  your app does.");
    lines.push("- Run `velloo theme:export ../<app>` to land `tailwind.config.ts` and");
    lines.push("  `globals.css` into your app from the design folder's theme.");
    lines.push("");
  } else if (answers.source === "cache") {
    lines.push("## Cached install");
    lines.push("");
    lines.push("The snapshot was installed under `~/.velloo/` — keyed to this design");
    lines.push("folder's project id. It's isolated from any host app. When you're");
    lines.push("ready to land the design into a real codebase, run");
    lines.push("`velloo theme:export <app>` to copy the theme over, and use `emit_code`");
    lines.push("(via MCP) to translate each screen into your app's conventions.");
    lines.push("");
  } else {
    lines.push("## Bundled install");
    lines.push("");
    lines.push("The shadcn snapshot lives inside the velloo binary. No files were");
    lines.push("written to your app. When you're ready to bring shadcn into your");
    lines.push("project, run `npx shadcn@latest init` there separately, then");
    lines.push("`velloo theme:export <app>` to align the theme.");
    lines.push("");
  }

  lines.push("## What the AI agent sees");
  lines.push("");
  lines.push("Velloo exposes ~55 MCP tools — discovery (`list_screens`, `list_components`,");
  lines.push("`list_snippets`, `get_theme`), tree mutations (`add_node`, `update_props`,");
  lines.push("`apply_classes`, `move_node`, …), snippets, theme operations (`set_token`,");
  lines.push("`apply_preset`, `derive_palette_from_color`, `match_vibe`), inspection");
  lines.push("(`inspect`, `inspect_dark_diff`, `screenshot`, `validate_classes`), code");
  lines.push("emission (`emit_code`, `emit_snippet`, `emit_theme`), and AI asset");
  lines.push("generators (`generate_svg`, `generate_image`).");
  lines.push("");
  lines.push("Designs are static by construction — click handlers, routing, and forms");
  lines.push("are no-ops in the canvas. The agent reads the design and writes real");
  lines.push("code into your app via `emit_code`.");
  lines.push("");
  return lines.join("\n");
}
