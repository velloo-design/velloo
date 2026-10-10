import type { Theme } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { type DesignRules, type DesignRulesState, designLanguage } from "../api.ts";
import type { CanvasState } from "./index.ts";

/**
 * How the stage was entered. `guided` walks someone defining a language for
 * the first time through it one decision at a time; `review` lays the whole of
 * an existing one out to move around in.
 */
type LanguageMode = "guided" | "review";

export type LanguageArea = "colour" | "type" | "corners" | "rules";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which parts of the language differ from the baseline the stage opened on. */
function changedAreas(
  baseline: LanguageBaseline,
  theme: Theme,
  rules: DesignRulesState,
): LanguageArea[] {
  const before = baseline.theme;
  const colour = (t: Theme) => [t.colors, t.colorsDark, t.palette, t.paletteDark];
  return [
    ...(same(colour(before), colour(theme)) ? [] : ["colour" as const]),
    ...(same(before.typography, theme.typography) ? [] : ["type" as const]),
    ...(same(before.radius, theme.radius) ? [] : ["corners" as const]),
    ...(baseline.rules.intent === rules.intent && same(baseline.rules.rules, rules.rules)
      ? []
      : ["rules" as const]),
  ];
}

/** What Cancel goes back to: the theme and rules as they stood when the stage opened. */
interface LanguageBaseline {
  theme: Theme;
  rules: DesignRulesState;
}

/**
 * The design-language stage. Edits made in it are live — they are ordinary
 * theme and rule writes, so the specimen and every board show them at once —
 * and Cancel is what takes them back.
 */
export interface LanguageSlice {
  /** The design's rules as the server last reported them; null until first loaded. */
  languageRules: DesignRulesState | null;
  languageMode: LanguageMode;
  languageBaseline: LanguageBaseline | null;
  /**
   * Which palette the stage is working in. One switch for the role editor and
   * the specimen, so the colours being edited are the colours on show.
   */
  languageScheme: "light" | "dark";
  /** The colour slots the design's framework reads; null where it does not say. */
  frameworkRoles: string[] | null;
  /**
   * Set when a changed language is kept on a design that already has boards:
   * what changed, for the prompt that asks an agent to bring them in line.
   */
  languageHandoff: LanguageArea[] | null;

  openLanguage(mode?: LanguageMode): Promise<void>;
  /** Leave, keeping what was changed. */
  finishLanguage(): Promise<void>;
  /** Leave, putting the theme and rules back as they were on entry. */
  cancelLanguage(): Promise<void>;
  refreshLanguage(): Promise<void>;
  saveRules(next: DesignRules): Promise<void>;
  setLanguageScheme(scheme: "light" | "dark"): void;
  dismissLanguageHandoff(): void;
}

/** Rule saves the server has not answered yet; its replies apply only once none are pending. */
let savesInFlight = 0;

export const createLanguageSlice: StateCreator<CanvasState, [], [], LanguageSlice> = (set, get) => {
  const leave = async () => {
    if (get().view !== "language") return;
    set({ view: "boards", languageBaseline: null });
    // Back to whichever theme the board behind the stage renders with.
    await get().loadTheme();
  };

  return {
    languageRules: null,
    languageMode: "review",
    languageBaseline: null,
    languageScheme: "light",
    frameworkRoles: null,
    languageHandoff: null,

    dismissLanguageHandoff() {
      set({ languageHandoff: null });
    },

    setLanguageScheme(languageScheme) {
      set({ languageScheme });
    },

    async openLanguage(mode = "review") {
      set({
        view: "language",
        languageMode: mode,
        languageBaseline: null,
        libraryItem: null,
        selection: null,
        hover: null,
        snippetFocus: null,
      });
      const [{ rules, frameworkRoles }] = await Promise.all([
        designLanguage.fetch(),
        get().loadTheme(),
      ]);
      const theme = get().theme;
      set({
        languageRules: rules,
        frameworkRoles,
        languageScheme: get().designMode,
        languageBaseline: theme ? { theme, rules } : null,
      });
    },

    async finishLanguage() {
      const { languageBaseline: baseline, theme, languageRules: rules, design } = get();
      const changed = baseline && theme && rules ? changedAreas(baseline, theme, rules) : [];
      await leave();
      // Tokens reach every board on their own. What they cannot reach — a
      // colour set by hand, a layout that now breaks a rule — is an agent's
      // job, and only worth raising when there are boards to go over.
      if (changed.length > 0 && (design?.boards.length ?? 0) > 0) set({ languageHandoff: changed });
    },

    async cancelLanguage() {
      const baseline = get().languageBaseline;
      if (baseline) {
        const { source } = baseline.rules;
        const { rules } = await designLanguage.restore({
          theme: baseline.theme,
          // A repo's DESIGN.md was never editable here, so there is nothing to put back.
          ...(source && !source.writable
            ? {}
            : {
                rules: source
                  ? { intent: baseline.rules.intent, rules: baseline.rules.rules }
                  : null,
              }),
        });
        set({ languageRules: rules });
      }
      await leave();
    },

    async refreshLanguage() {
      const { rules, frameworkRoles } = await designLanguage.fetch();
      // A save still in flight is newer than anything the server can report yet.
      set(savesInFlight === 0 ? { languageRules: rules, frameworkRoles } : { frameworkRoles });
    },

    async saveRules(next) {
      const before = get().languageRules;
      // Shown at once, and built on by the next edit: two rules added in quick
      // succession would otherwise each be saved on top of the list before either.
      if (before) set({ languageRules: { ...before, ...next } });
      savesInFlight++;
      try {
        const { rules } = await designLanguage.saveRules(next);
        if (savesInFlight === 1) set({ languageRules: rules });
      } catch (err) {
        if (savesInFlight === 1) set({ languageRules: (await designLanguage.fetch()).rules });
        throw err;
      } finally {
        savesInFlight--;
      }
    },
  };
};
