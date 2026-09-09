import type { Theme } from "@velloo/schema";
import elsewhere from "./elsewhere/theme/default.json" with { type: "json" };
export function buildDefaultTheme(): Theme {
  return structuredClone(elsewhere as Theme);
}
