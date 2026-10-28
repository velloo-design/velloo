import type { Screen } from "@velloo/schema";
import pc from "picocolors";
import type { WizardAnswers } from "./answers.ts";
import { buildHandoffPrompt, expandHandoffPrompt, wantsHandoff } from "./handoff.ts";

/**
 * Print the agent handoff for the starts that have one, for a scripted init
 * with no browser page to hand it over in: the prompt, whole, with the real
 * screen list in it.
 */
export function printAgentHandoff(answers: WizardAnswers, scaffold: { screens: Screen[] }): void {
  if (!wantsHandoff(answers)) return;
  const { screens } = scaffold;
  const prompt = expandHandoffPrompt(buildHandoffPrompt(answers, screens), screens);
  console.log(pc.bold("  Start your agent"));
  console.log(pc.dim("    Paste this to your AI agent:"));
  console.log("");
  for (const line of prompt.split("\n")) console.log(pc.cyan(`    ${line}`));
  console.log("");
}
