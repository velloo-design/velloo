import { relative, sep } from "node:path";
import type { Screen } from "@velloo/schema";
import type { WizardAnswers } from "./answers.ts";
import { WIZARD_PROVIDERS } from "./provider-registry.ts";

/**
 * Stands in for the screen list in the handoff prompt so the human-facing
 * text stays short; `expandHandoffPrompt` swaps in the real list right
 * before the prompt is sent to the agent.
 */
export const SCREENS_PLACEHOLDER = "{{screens}}";

function buildWith(answers: WizardAnswers): string {
  // An app on a framework Velloo has no adapter for still has its components:
  // they render from its own install (the Repo shelves), not from primitives.
  const unsupported = answers.detected?.unsupportedUi;
  if (answers.library === "none" && unsupported) return `my own ${unsupported} components`;
  return WIZARD_PROVIDERS[answers.library].handoffComponentsLabel;
}

function appContext(answers: WizardAnswers): string[] {
  const appRels = [
    ...new Set((answers.selectedRoutes ?? []).map((r) => r.appRel).filter(Boolean)),
  ] as string[];
  if (appRels.length > 1) {
    return [
      `It's a monorepo with ${appRels.length} apps (${appRels.map((r) => `\`${r}\``).join(", ")}), one board each.`,
    ];
  }
  const uiRel = relative(answers.appRoot, answers.scanRoot).split(sep).join("/");
  return uiRel && !uiRel.startsWith("..") ? [`The app lives in \`${uiRel}/\`.`] : [];
}

/**
 * The number is a floor, not the goal: told only "faithfully", agents compared
 * once and stopped at whatever they had; told "until it scores 0.9", they
 * stopped at 0.91. Agents also read "use the velloo tools" as "no
 * shell" and waited for Velloo to start the app, which it never does. How to
 * reach the bar — theme import, fonts, login walls — is in the MCP
 * instructions.
 */
const RECREATE_BAR =
  "as closely as you can: keep fixing `compare_to_url`'s top mismatches, and don't stop below 0.9. Start the app yourself — Velloo never runs it.";

/**
 * Numbered, because with the steps run together in one sentence an agent went
 * straight to the alternatives and never recreated the page.
 */
const ALTERNATIVES = "2. Then explore a few different directions side by side on the same board.";

/** Whether this init mode should offer an agent handoff prompt. */
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
 * The copy-paste prompt that starts the user's agent on the goal chosen at
 * init. It states the goal and nothing else: how to work in Velloo ships in
 * the MCP instructions every session already receives.
 */
export function buildHandoffPrompt(answers: WizardAnswers, screens: Screen[]): string {
  return [...goalLines(answers, screens), ...appContext(answers)].join("\n");
}

function goalLines(answers: WizardAnswers, screens: Screen[]): string[] {
  const using = buildWith(answers);
  switch (answers.initialContent) {
    case "redesign-screen": {
      const name =
        answers.screenName?.trim() || screens[0]?.name || screens[0]?.id || "the chosen screen";
      return [
        `Use Velloo to redesign **${name}** with ${using}:`,
        `1. Match my app's theme and fonts, then recreate the whole real page, top to bottom, on its scaffolded screen ${RECREATE_BAR}`,
        ALTERNATIVES,
      ];
    }
    case "component": {
      const target = answers.componentDescription?.trim() || "the component";
      return [
        `Use Velloo to redesign **${target}** with ${using}:`,
        `1. Match my app's theme and fonts, then recreate it on the scaffolded board ${RECREATE_BAR}`,
        ALTERNATIVES,
      ];
    }
    case "custom": {
      const request = answers.customRequest?.trim() || "the design I described";
      return [
        `Use Velloo to design this with ${using}, putting alternative directions side by side on the board:`,
        "",
        request,
        ...(answers.captureUrl
          ? [
              "",
              `It's based on ${answers.captureUrl}: capture it with \`start_capture_session\` first — I'll sign in if needed.`,
            ]
          : []),
      ];
    }
    default:
      return [
        `Use Velloo to recreate my app's pages with ${using}, ${
          screens.length > 0 ? "one scaffolded screen each:" : "one screen per route."
        }`,
        ...(screens.length > 0 ? [SCREENS_PLACEHOLDER] : []),
        `Match my app's theme and fonts first. Start with the most important page, and recreate each one top to bottom ${RECREATE_BAR}`,
        "Each screen has a desktop and a mobile frame; make both hold up.",
      ];
  }
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
