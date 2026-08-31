/**
 * Minimal sample shipped by `velloo init --library=antd --initial-content=sample`.
 * Two screens (Welcome + Sign up) on one board (Main), demonstrating the antd
 * component set + inline `style` objects in a couple of common compositions — a
 * one-glance answer to "what does the antd adapter give me?"
 *
 * The welcome sample isn't ported to antd (its shadcn-specific composition would need a full
 * redesign); the user asks the agent to expand these starter screens once
 * they're on the canvas.
 */
import type { Board, Screen, Snippet } from "@velloo/schema";

import mainBoard from "./antd/boards/main.json" with { type: "json" };
import signup from "./antd/screens/form.json" with { type: "json" };
import welcome from "./antd/screens/welcome.json" with { type: "json" };

export function buildAntdScreens(): Screen[] {
  return [welcome as Screen, signup as Screen];
}

export function buildAntdBoards(): Board[] {
  return [mainBoard as Board];
}

export function buildAntdSnippets(): Snippet[] {
  return [];
}
