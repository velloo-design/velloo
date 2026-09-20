import { relative, sep } from "node:path";
import type { Board, Screen } from "@velloo/schema";
import type { WizardAnswers } from "./answers.ts";
import { WIZARD_PROVIDERS } from "./provider-registry.ts";

/**
 * Stands in for the screen list in the handoff prompt so the human-facing
 * text stays short; `expandHandoffPrompt` swaps in the real list right
 * before the prompt is sent to the agent.
 */
export const SCREENS_PLACEHOLDER = "{{screens}}";

function libraryLabel(answers: WizardAnswers): string {
  // An app on a framework Velloo has no adapter for still has its components:
  // they render from its own install (the Repo shelves), not from primitives.
  const unsupported = answers.detected?.unsupportedUi;
  if (answers.library === "none" && unsupported) return `own ${unsupported}`;
  return WIZARD_PROVIDERS[answers.library].handoffComponentsLabel;
}

function appContextLines(answers: WizardAnswers): string[] {
  const lines: string[] = [];
  const appRels = [
    ...new Set((answers.selectedRoutes ?? []).map((r) => r.appRel).filter(Boolean)),
  ] as string[];
  if (appRels.length > 1) {
    lines.push(
      `This is a monorepo with ${appRels.length} apps (${appRels.map((r) => `\`${r}\``).join(", ")}); each app's screens sit on their own board. Run the matching app's dev server when comparing screens.`,
    );
  } else {
    const uiRel = relative(answers.appRoot, answers.scanRoot).split(sep).join("/");
    if (uiRel && !uiRel.startsWith("..")) {
      lines.push(`This app's UI lives in \`${uiRel}/\` — run its dev server from there.`);
    }
  }
  return lines;
}

/**
 * Every host-reading start opens with this. The canvas renders the app's own
 * components only once their preview entry is set up, and draws everything
 * else with Velloo's components themed by the folder's tokens — so an
 * uncalibrated board won't look like the app. Naming the skill keeps the
 * prompt short; the skill owns the procedure.
 */
function setupFirstGuidance(): string {
  return "**Calibrate before you design** — run the **velloo-setup** skill first. My app's own components render on the canvas once their preview entry is set up (`preview_status`, then `set_preview_entry`); everything else is drawn with Velloo's components themed by this folder's tokens, so an uncalibrated board won't look like my app. Set up the preview entry, import my stylesheet, set the real fonts, and get the app running so there's something real to check against. Use my components from list_components' Repo shelves rather than rebuilding them from primitives. Tell me in a line what you matched and what stayed unverified.";
}

/** Setup already got the app running and past any auth — this is the loop. */
function compareGuidance(): string {
  return "Compare against the real app, not memory: iterate with `screenshot` + `compare_to_url` at the same viewport and fix the `topMismatches` in the order they're ranked. If a capture comes back `unverified`, the similarity number means nothing — and if the reason is a login wall, call `start_capture_session` so I can sign in and capture the page for you, then verify against it with `compare_to_url { captureId }`.";
}

/**
 * The opening move when the design target is a live site rather than local
 * code — the agent drives the capture session, the user drives the browser.
 */
function captureSiteGuidance(url: string): string {
  return [
    `**Start by capturing the site.** Call \`start_capture_session { url: "${url}" }\` — it opens a browser window I drive. I'll log in if needed and hit "Capture page" on each page worth designing from; the call returns straight away, so poll \`list_captures\` until my captures appear.`,
    "Then read each one with `get_capture`: it gives you a structural outline (repeated blocks are marked — those are your component candidates), the site's CSS custom properties as `import_theme`-ready CSS, and its images. Run `import_theme` with that CSS before composing so the real tokens resolve.",
    "Re-express the pages with real components against the theme — do not transcribe the DOM node-for-node. Verify each screen with `compare_to_url { captureId }`.",
  ].join("\n");
}

function exploreAlternativesGuidance(): string {
  return "After the faithful recreation, explore alternatives on the same board — side-by-side A/B/C (or more) frames or grouped explorations of different directions. Velloo's strength is comparing options visually; do not stop at a single redesign.";
}

/**
 * Whether this init mode should offer an agent handoff prompt.
 */
export function wantsHandoff(answers: WizardAnswers): boolean {
  switch (answers.initialContent) {
    case "scan":
    case "redesign-screen":
    case "component":
    case "custom":
      return true;
    default:
      return false;
  }
}

/**
 * Build the copy-paste prompt that gets the user's agent started on the
 * goal chosen at init. Deliberately short: folder ownership, snippets,
 * tokens, and verification tools already ship in the MCP instructions.
 */
export function buildHandoffPrompt(
  answers: WizardAnswers,
  screens: Screen[],
  boards: Board[],
): string {
  switch (answers.initialContent) {
    case "redesign-screen":
      return buildRedesignScreenHandoff(answers, screens);
    case "component":
      return buildComponentHandoff(answers);
    case "custom":
      return buildCustomHandoff(answers);
    case "scan":
      return buildLegacyScanHandoff(answers, screens, boards);
    default:
      return buildLegacyScanHandoff(answers, screens, boards);
  }
}

function buildRedesignScreenHandoff(answers: WizardAnswers, screens: Screen[]): string {
  const name =
    answers.screenName?.trim() || screens[0]?.name || screens[0]?.id || "the chosen screen";
  const lines = [
    `Recreate and then explore alternatives for **${name}** as a Velloo design. Work entirely through the velloo MCP tools.`,
    ...appContextLines(answers),
  ];
  if (screens.length > 0) {
    lines.push(
      `A placeholder screen is already scaffolded (desktop + mobile frames — edits sync). Design it with the project's ${libraryLabel(answers)} components:`,
      SCREENS_PLACEHOLDER,
    );
  } else {
    lines.push(
      `- Create a Velloo screen for **${name}** using the project's ${libraryLabel(answers)} components.`,
    );
  }
  lines.push(
    `1. ${setupFirstGuidance()}`,
    `2. **Recreate** the real page faithfully. ${compareGuidance()}`,
    `3. **Then explore alternatives** — ${exploreAlternativesGuidance()}`,
  );
  return lines.join("\n");
}

function buildComponentHandoff(answers: WizardAnswers): string {
  const target = answers.componentDescription?.trim() || "the component";
  const lines = [
    `Redesign **${target}** in Velloo — recreate it, then explore alternatives. Work entirely through the velloo MCP tools.`,
    ...appContextLines(answers),
    `A component-focused board is scaffolded. Target: **${target}**. Prefer a snippet if the piece should be reused.`,
    `1. ${setupFirstGuidance()}`,
    `2. **Recreate** the current component faithfully with the project's ${libraryLabel(answers)} components. ${compareGuidance()}`,
    `3. **Then explore alternatives** — ${exploreAlternativesGuidance()}`,
  ];
  return lines.join("\n");
}

function buildCustomHandoff(answers: WizardAnswers): string {
  const request = answers.customRequest?.trim() || "the design I described";
  const lines = [
    "Design this in Velloo. Work entirely through the velloo MCP tools.",
    "",
    "**Request:**",
    request,
    "",
    ...(answers.captureUrl ? [captureSiteGuidance(answers.captureUrl), ""] : []),
    setupFirstGuidance(),
    `Then design it with the project's ${libraryLabel(answers)} components. When comparing options, put alternatives side-by-side on the board (explorations) instead of overwriting a single direction.`,
  ];
  return lines.join("\n");
}

/** Legacy multi-route scan handoff (non-interactive `--start=scan`). */
function buildLegacyScanHandoff(
  answers: WizardAnswers,
  screens: Screen[],
  boards: Board[],
): string {
  const lines = [
    "Recreate this app's pages as a Velloo design — one Velloo screen per page, faithful to the real UI. Work entirely through the velloo MCP tools (wired during setup).",
  ];
  lines.push(...appContextLines(answers));
  lines.push(setupFirstGuidance());

  if (screens.length > 0) {
    lines.push(
      `These screens are already scaffolded from the app's routes — design these, and only these, with the project's ${libraryLabel(answers)} components:`,
      SCREENS_PLACEHOLDER,
    );
    if (answers.agentPicksFirst) {
      lines.push(
        "Start with the highest-impact screen (usually the landing page or the main dashboard) and design it fully — it sets the quality bar. Then work through the rest.",
      );
    }
  } else {
    lines.push(
      `- For each route/page in the app, create a Velloo screen that reproduces that page's UI from the project's ${libraryLabel(answers)} components.`,
    );
  }

  lines.push(
    "- Each screen already has a desktop and a mobile frame on its board (same screen — edits sync); make sure layouts hold at both widths.",
  );
  if (boards.some((b) => b.groups.length > 0)) {
    lines.push("- Frames are pre-grouped by route section — keep the groups tidy as flows evolve.");
  }
  lines.push(`- ${compareGuidance()}`);
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
