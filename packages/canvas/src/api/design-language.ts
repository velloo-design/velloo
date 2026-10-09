import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

/** The specimen's board and screen id. Mirrors the server's `SPECIMEN_ID`. */
export const SPECIMEN_ID = "design-language";

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

export interface DesignLanguageState {
  rules: DesignRulesState;
  specimen: { screenId: string; boardId: string | null } | null;
}

export const designLanguage = {
  fetch(): Promise<DesignLanguageState> {
    return getJson("/api/design-language", "designLanguage");
  },
  saveRules(next: DesignRules) {
    return postJson<{ rules: DesignRulesState }>("/api/design-language/rules", next);
  },
  /** Creates the specimen board when the design has none; an existing one is left as it is. */
  buildSpecimen() {
    return postJson<{ boardId: string; screenId: string; built: boolean }>(
      "/api/design-language/specimen",
      {},
    );
  },
};
