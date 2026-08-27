import { relative } from "node:path";
import type { Board, Screen } from "@velloo/schema";
import type { WizardAnswers } from "./answers.ts";
import { WIZARD_PROVIDERS } from "./provider-registry.ts";

/**
 * Stands in for the screen list in the handoff prompt so the human-facing
 * text stays short; `expandHandoffPrompt` swaps in the real list right
 * before the prompt is sent to the agent.
 */
export const SCREENS_PLACEHOLDER = "{{screens}}";

function libraryLabel(library: WizardAnswers["library"]): string {
  return WIZARD_PROVIDERS[library].handoffComponentsLabel;
}

/**
 * Build the copy-paste prompt that gets the user's agent to recreate their app
 * as a Velloo design. Init can't screenshot the app itself (it isn't running
 * yet), so the agent — which has the velloo MCP tools and a shell — does the
 * work. Deliberately short: everything a generic Velloo session needs (folder
 * ownership, snippets, semantic tokens, verification tools) already ships in
 * the MCP server's instructions — this prompt carries only what's specific to
 * *this* app and *this* scaffold.
 *
 * The screen list appears as `{{screens}}` — call `expandHandoffPrompt`
 * before actually sending the prompt.
 */
export function buildHandoffPrompt(
  answers: WizardAnswers,
  screens: Screen[],
  boards: Board[],
): string {
  const lines = [
    "Recreate this app's pages as a Velloo design — one Velloo screen per page, faithful to the real UI. Work entirely through the velloo MCP tools (wired during setup).",
  ];

  // Multi-app scan: one board per app; the agent must pair each screen with
  // the right dev server. Single nested app keeps the simpler pointer.
  const appRels = [
    ...new Set((answers.selectedRoutes ?? []).map((r) => r.appRel).filter(Boolean)),
  ] as string[];
  if (appRels.length > 1) {
    lines.push(
      `This is a monorepo with ${appRels.length} apps (${appRels.map((r) => `\`${r}\``).join(", ")}); each app's screens sit on their own board. Run the matching app's dev server when comparing screens.`,
    );
  } else {
    const uiRel = relative(answers.appRoot, answers.scanRoot);
    if (uiRel && !uiRel.startsWith("..")) {
      lines.push(`This app's UI lives in \`${uiRel}/\` — run its dev server from there.`);
    }
  }

  if (screens.length > 0) {
    lines.push(
      `These ${screens.length} screens are already scaffolded from the app's routes — design these, and only these, with the project's ${libraryLabel(answers.library)} components:`,
      SCREENS_PLACEHOLDER,
    );
    if (answers.agentPicksFirst) {
      lines.push(
        "Start with the highest-impact screen (usually the landing page or the main dashboard) and design it fully — it sets the quality bar. Then work through the rest.",
      );
    }
  } else {
    lines.push(
      `- For each route/page in the app, create a Velloo screen that reproduces that page's UI from the project's ${libraryLabel(answers.library)} components.`,
    );
  }

  lines.push(
    "- Each screen already has a desktop and a mobile frame on its board (same screen — edits sync); make sure layouts hold at both widths.",
  );
  if (boards.some((b) => b.groups.length > 0)) {
    lines.push("- Frames are pre-grouped by route section — keep the groups tidy as flows evolve.");
  }
  lines.push(
    "- What matters most for quality: compare against the real app, not memory. Get the app running first — start its dev server yourself if the scripts make it obvious; otherwise ask me for the command, a running URL, or a deployed preview. If pages need sign-in, ask me how to authenticate (`compare_to_url` accepts `storageStatePath` / `cookies`), or use any browser tooling I've set up. Then iterate each screen with `screenshot` + `compare_to_url` until it matches the real page.",
  );
  return lines.join("\n");
}

/**
 * Replace `{{screens}}` with the real screen list (one bullet per screen).
 * Must run before the prompt is handed to the agent; a no-op when the user
 * edited the placeholder away.
 */
export function expandHandoffPrompt(prompt: string, screens: Screen[]): string {
  if (!prompt.includes(SCREENS_PLACEHOLDER)) return prompt;
  const list = screens.map((s) => `  - ${s.name || s.id}`).join("\n");
  return prompt.split(SCREENS_PLACEHOLDER).join(list);
}
