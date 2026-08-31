/**
 * Minimal sample shipped by `velloo init --library=chakra --initial-content=sample`.
 * Two screens (Welcome + Sign up) on one board (Main), demonstrating the chakra
 * component set + `sx` styling in a couple of common compositions — a
 * one-glance answer to "what does the chakra adapter give me?"
 *
 * The welcome sample isn't ported to chakra (its shadcn-specific composition would need a
 * full redesign); the user asks the agent to expand these starter screens once
 * they're on the canvas.
 */
import type { Board, Screen, Snippet } from "@velloo/schema";

import mainBoard from "./chakra/boards/main.json" with { type: "json" };
import signup from "./chakra/screens/form.json" with { type: "json" };
import welcome from "./chakra/screens/welcome.json" with { type: "json" };

export function buildChakraScreens(): Screen[] {
  return [welcome as Screen, signup as Screen];
}

export function buildChakraBoards(): Board[] {
  return [mainBoard as Board];
}

export function buildChakraSnippets(): Snippet[] {
  return [];
}
