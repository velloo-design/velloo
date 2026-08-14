/**
 * Default theme for the Pulse sample design. Indigo accent (#5e6ad2) with a
 * cohesive dark mode. Lives as JSON under ./pulse/theme/default.json so it
 * can be iterated in the canvas's theme panel and re-copied here.
 */
import type { Theme } from "@velloo/schema";

import pulseTheme from "./pulse/theme/default.json" with { type: "json" };

export function buildDefaultTheme(): Theme {
  return pulseTheme as Theme;
}
