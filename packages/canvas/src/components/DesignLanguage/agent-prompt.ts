/**
 * The ask that starts an agent on a proposal. It names the outcome and the one
 * tool that finishes it; how to match a theme and fonts is the velloo-setup
 * skill's job and the MCP instructions', not this prompt's.
 */
export const PROPOSE_LANGUAGE_PROMPT = [
  "Use Velloo to propose this app's design language, for me to review on the canvas:",
  "1. Match the app's theme and fonts (the velloo-setup skill covers how).",
  "2. Call set_design_language with the intent in a sentence or two and the Do's and Don'ts you can point to evidence for in the code.",
  "Tell me what you could not determine instead of guessing.",
].join("\n");
