/**
 * Minimal sample shipped by `velloo init --library=none --initial-content=sample`.
 * Two screens (Welcome + Sign up) on one board (Main), demonstrating the
 * no-library primitive set in a couple of common compositions. Designed
 * to be a one-glance answer to "what does this provider give me?"
 *
 * Pulse itself isn't ported to no-lib — its rich shadcn primitives
 * (Avatar, Tabs, Accordion, Calendar, Chart, …) have no equivalent
 * here. The user can ask the agent to expand on these starter screens
 * once they're on the canvas.
 */
import type { Board, Screen, Snippet } from "@velloo/schema";

import mainBoard from "./nolib/boards/main.json" with { type: "json" };
import form from "./nolib/screens/form.json" with { type: "json" };
import welcome from "./nolib/screens/welcome.json" with { type: "json" };

export function buildNoLibScreens(): Screen[] {
  return [welcome as Screen, form as Screen];
}

export function buildNoLibBoards(): Board[] {
  return [mainBoard as Board];
}

export function buildNoLibSnippets(): Snippet[] {
  return [];
}
