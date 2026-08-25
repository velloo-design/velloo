import { relative } from "node:path";
import type { Board, Screen } from "@velloo/schema";
import type { WizardAnswers } from "./answers.ts";

/**
 * Stands in for the screen list in the handoff prompt so the human-facing
 * text stays short; `expandHandoffPrompt` swaps in the real list right
 * before the prompt is sent to the agent.
 */
export const SCREENS_PLACEHOLDER = "{{screens}}";

function libraryLabel(library: WizardAnswers["library"]): string {
  if (library === "mui") return "Material UI";
  if (library === "none") return "velloo primitive";
  return "shadcn";
}

/**
 * Build the copy-paste prompt that gets the user's agent to recreate their app
 * as a Velloo design: a screen per page, boards with mobile + desktop frames,
 * reusable snippets, all verified against the running app via the `screenshot`
 * tool. Init can't screenshot the app itself (it isn't running yet), so the
 * agent — which has the velloo MCP tools and a shell — does the work.
 *
 * The screen list appears as `{{screens}}` — call `expandHandoffPrompt`
 * before actually sending the prompt.
 */
export function buildHandoffPrompt(
  answers: WizardAnswers,
  screens: Screen[],
  boards: Board[],
): string {
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
      `Build only these ${screens.length} screens (each already has a placeholder screen + a board frame), from the project's ${libraryLabel(answers.library)} components:`,
      SCREENS_PLACEHOLDER,
    );
    if (answers.agentPicksFirst) {
      lines.push(
        "First, choose the highest-impact screen yourself (usually the landing page or the main dashboard) and design it fully — it sets the quality bar for the rest. Then continue screen by screen.",
      );
    }
  } else {
    lines.push(
      `- For each route/page in the app, create a Velloo screen that reproduces that page's UI from the project's ${libraryLabel(answers.library)} components.`,
    );
  }

  lines.push("- Lay the screens out on boards with both mobile and desktop frames.");
  if (boards.some((b) => b.groups.length > 0)) {
    lines.push(
      "- Frames are pre-grouped on the board by route section — keep the groups tidy, and reorganize boards/frames/groups as flows take shape.",
    );
  }
  lines.push(
    "- Extract repeated UI (nav, headers, cards, footers) into reusable snippets.",
    "- Start the app's dev server and use the velloo `screenshot` tool to compare each screen against the real page; iterate until they match.",
  );
  lines.push(
    answers.library === "mui"
      ? "- Style with `sx` and theme palette keys (primary.main, text.secondary, …) so screens follow the folder theme."
      : "- Keep semantic theme tokens (bg-background, text-foreground, …).",
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
