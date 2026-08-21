/**
 * Minimal sample shipped by `velloo init --library=mui --initial-content=sample`.
 * Two screens (Welcome + Sign up) on one board (Main), demonstrating the MUI
 * component set + `sx` styling in a couple of common compositions — a one-glance
 * answer to "what does the MUI adapter give me?"
 *
 * Pulse isn't ported to MUI (its shadcn-specific composition would need a full
 * redesign); the user asks the agent to expand these starter screens once
 * they're on the canvas. See docs/framework-native.md.
 */
import type { Board, Screen, Snippet } from "@velloo/schema";

import mainBoard from "./mui/boards/main.json" with { type: "json" };
import signup from "./mui/screens/form.json" with { type: "json" };
import welcome from "./mui/screens/welcome.json" with { type: "json" };

export function buildMuiScreens(): Screen[] {
  return [welcome as Screen, signup as Screen];
}

export function buildMuiBoards(): Board[] {
  return [mainBoard as Board];
}

export function buildMuiSnippets(): Snippet[] {
  return [];
}
