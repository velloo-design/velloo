import { relative, sep } from "node:path";
import type { Screen } from "@velloo/schema";
import { hasAppToMatch, type WizardAnswers } from "./answers.ts";

/**
 * Stands in for the screen list in the handoff prompt so the human-facing
 * text stays short; `expandHandoffPrompt` swaps in the real list right
 * before the prompt is sent to the agent.
 */
export const SCREENS_PLACEHOLDER = "{{screens}}";

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
 * The first step wherever there is an app: the design is matched to it (theme,
 * fonts, the components it has) before anything is drawn. Said in the words
 * the `velloo-setup` skill answers to; the parenthesis is for an agent that
 * has no skills and only this sentence to go on.
 */
const SETUP = "Set Velloo up for my app (theme, fonts, components).";

/**
 * The number is a floor, not the goal: told only "faithfully", agents compared
 * once and stopped at whatever they had; told "until it scores 0.9", they
 * stopped at 0.91. Agents also read "use the velloo tools" as "no shell" and
 * waited for Velloo to start the app, which it never does. How to reach the
 * bar — theme import, fonts, login walls — is in the MCP instructions.
 */
const RECREATE_BAR =
  "keep fixing `compare_to_url`'s top mismatches and don't stop below 0.9. Start the app yourself.";

/**
 * A step of its own, because with the steps run together in one sentence an
 * agent went straight to the alternatives and never recreated the page.
 */
const ALTERNATIVES = "Explore a few different directions beside it on the same board.";

/** The steps, numbered, opening with the setup wherever there is an app to set up for. */
function steps(answers: WizardAnswers, ...rest: string[]): string[] {
  return [...(hasAppToMatch(answers) ? [SETUP] : []), ...rest].map(
    (step, i) => `${i + 1}. ${step}`,
  );
}

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
  switch (answers.initialContent) {
    case "redesign-screen": {
      const name =
        answers.screenName?.trim() || screens[0]?.name || screens[0]?.id || "the chosen screen";
      return [
        `Use Velloo to redesign **${name}**:`,
        ...steps(
          answers,
          `Recreate the whole real page on its scaffolded screen — ${RECREATE_BAR}`,
          ALTERNATIVES,
        ),
      ];
    }
    case "component": {
      const target = answers.componentDescription?.trim() || "the component";
      return [
        `Use Velloo to redesign **${target}**:`,
        ...steps(answers, `Recreate it on the scaffolded board — ${RECREATE_BAR}`, ALTERNATIVES),
      ];
    }
    case "custom": {
      const request = answers.customRequest?.trim() || "the design I described";
      return [
        "Use Velloo to design this, with alternative directions side by side on the board:",
        "",
        request,
        ...(answers.captureUrl
          ? [
              "",
              `It's based on ${answers.captureUrl}: capture it with \`start_capture_session\` first — I'll sign in if needed.`,
            ]
          : hasAppToMatch(answers)
            ? ["", `First: ${SETUP}`]
            : []),
      ];
    }
    default:
      return [
        `Use Velloo to recreate my app's pages, ${
          screens.length > 0 ? "one scaffolded screen each:" : "one screen per route:"
        }`,
        ...(screens.length > 0 ? [SCREENS_PLACEHOLDER] : []),
        ...steps(
          answers,
          `Recreate each page top to bottom, the most important first — ${RECREATE_BAR}`,
          "Each screen has a desktop and a mobile frame; make both hold up.",
        ),
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
