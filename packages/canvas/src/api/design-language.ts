import type { Theme } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

/** One stated rule. Mirrors the server's `DesignRule`. */
export interface DesignRule {
  kind: "do" | "dont";
  text: string;
}

export interface DesignRules {
  intent: string;
  rules: DesignRule[];
}

export interface DesignRulesState extends DesignRules {
  /**
   * The document the rules come from. `writable` is false for a repo's
   * DESIGN.md, which Velloo reads and never writes; null when the design
   * follows no document yet, so the first save creates its `guidance.md`.
   */
  source: { path: string; writable: boolean } | null;
}

export type SpecimenScheme = "light" | "dark";

/**
 * The specimen is a render, not a screen: the server builds it on request from
 * the design's library and the theme named. `version` is only a cache key.
 */
export function specimenSrc(scheme: SpecimenScheme, version: number, themeName: string): string {
  const theme = themeName === "default" ? "" : `&theme=${encodeURIComponent(themeName)}`;
  return `/api/render/specimen?mode=${scheme}${theme}&v=${version}`;
}

export const designLanguage = {
  /**
   * The rules, and the colour slots the design's framework itself reads —
   * null where the framework does not say (or reads all of them).
   */
  fetch(): Promise<{ rules: DesignRulesState; frameworkRoles: string[] | null }> {
    return getJson("/api/design-language", "designLanguage");
  },
  saveRules(next: DesignRules) {
    return postJson<{ rules: DesignRulesState }>("/api/design-language/rules", next);
  },
  /**
   * Put a theme (`name`, the default when left out) and the rules back as they
   * were. `rules: null` says the design followed no document then; leave it
   * out when the rules were never editable.
   */
  restore(baseline: { theme?: Theme; name?: string; rules?: DesignRules | null }) {
    return postJson<{ rules: DesignRulesState }>("/api/design-language/restore", baseline);
  },
};
