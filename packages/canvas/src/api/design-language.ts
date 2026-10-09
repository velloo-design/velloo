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
 * the design's library and default theme. `version` is only a cache key.
 */
export function specimenSrc(scheme: SpecimenScheme, version: number): string {
  return `/api/render/specimen?mode=${scheme}&v=${version}`;
}

export const designLanguage = {
  async fetchRules(): Promise<DesignRulesState> {
    const body = await getJson<{ rules: DesignRulesState }>(
      "/api/design-language",
      "designLanguage",
    );
    return body.rules;
  },
  saveRules(next: DesignRules) {
    return postJson<{ rules: DesignRulesState }>("/api/design-language/rules", next);
  },
  /**
   * Put the theme and rules back as they were. `rules: null` says the design
   * followed no document then; leave it out when the rules were never editable.
   */
  restore(baseline: { theme: Theme; rules?: DesignRules | null }) {
    return postJson<{ rules: DesignRulesState }>("/api/design-language/restore", baseline);
  },
};
