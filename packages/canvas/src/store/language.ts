import type { Theme } from "@velloo/schema";
import type { StateCreator } from "zustand";
import {
  type DesignRules,
  type DesignRulesState,
  designLanguage,
  mutate,
  theme as themeApi,
} from "../api.ts";
import type { CanvasState } from "./index.ts";

/**
 * How the stage was entered. `guided` walks someone defining a language for
 * the first time through it one decision at a time; `review` lays the whole of
 * an existing one out to move around in.
 */
type LanguageMode = "guided" | "review";

type LanguageArea = "colour" | "type" | "corners" | "rules";

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

/** A kept change that boards may not fully follow yet: what changed, in which theme. */
export interface LanguageHandoff {
  theme: string;
  areas: LanguageArea[];
  /** Names of the boards that render with that theme. */
  boards: string[];
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
  /**
   * The theme the stage is on: the one the board behind it renders with,
   * unless it was opened for another. The stage's edits, its specimen and its
   * Cancel all follow this rather than always the default.
   */
  languageTheme: string;
  /**
   * True when the theme was made for this visit. It is then a draft until
   * Done: Cancel removes it, and only Done puts the board on it.
   */
  languageThemeIsNew: boolean;
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
  languageHandoff: LanguageHandoff | null;

  /** Open the stage on `theme` — by default the one the board on screen uses. */
  openLanguage(mode?: LanguageMode, theme?: string): Promise<void>;
  /** Make a theme as a copy of the one on screen and walk through defining it. */
  startTheme(name: string): Promise<void>;
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
    set({ view: "boards", languageBaseline: null, languageThemeIsNew: false });
    // Back to whichever theme the board behind the stage renders with.
    await get().loadTheme();
  };

  const boardTheme = () => {
    const { currentBoardId, boards } = get();
    return (currentBoardId ? boards[currentBoardId]?.theme : undefined) ?? "default";
  };

  const open = async (mode: LanguageMode, theme: string, isNew: boolean) => {
    set({
      view: "language",
      languageMode: mode,
      languageTheme: theme,
      languageThemeIsNew: isNew,
      languageBaseline: null,
      libraryItem: null,
      selection: null,
      hover: null,
      snippetFocus: null,
    });
    // The stage says which theme it is on once a design has more than one.
    void get().loadFolderConfig();
    const [{ rules, frameworkRoles }] = await Promise.all([
      designLanguage.fetch(),
      get().loadTheme(),
    ]).catch(async (error: unknown) => {
      // The stage has no way out until it has a baseline to cancel to, so one
      // that could not load goes back to the board instead of waiting on it.
      await leave().catch(() => {});
      throw error;
    });
    const loaded = get().theme;
    set({
      languageRules: rules,
      frameworkRoles,
      languageScheme: get().designMode,
      languageBaseline: loaded ? { theme: loaded, rules } : null,
    });
  };

  return {
    languageRules: null,
    languageMode: "review",
    languageTheme: "default",
    languageThemeIsNew: false,
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

    openLanguage(mode = "review", theme) {
      return open(mode, theme ?? boardTheme(), false);
    },

    async startTheme(name) {
      // A copy of the theme on screen, not of the default: the point is a
      // variation of what this board already looks like.
      await themeApi.addTheme(name, boardTheme());
      await open("guided", name, true);
    },

    async finishLanguage() {
      const {
        languageBaseline: baseline,
        languageTheme: name,
        languageThemeIsNew: isNew,
        theme,
        languageRules: rules,
        currentBoardId,
      } = get();
      const changed = baseline && theme && rules ? changedAreas(baseline, theme, rules) : [];
      // A new theme was made for the board on screen; keeping it is what puts
      // the board on it.
      if (isNew && currentBoardId) {
        await mutate.updateBoard({ boardId: currentBoardId, patch: { theme: name } });
      }
      await leave();
      // Tokens reach every board on their own. What they cannot reach — a
      // colour set by hand, a layout that now breaks a rule — is an agent's
      // job, and only worth raising when there are boards to go over.
      const boards = Object.values(get().boards)
        .filter((board) =>
          // The pin just written may not have come back over the socket yet.
          isNew ? board.id === currentBoardId : (board.theme ?? "default") === name,
        )
        .map((board) => board.name);
      if (changed.length > 0 && boards.length > 0) {
        set({ languageHandoff: { theme: name, areas: changed, boards } });
      }
    },

    async cancelLanguage() {
      const { languageBaseline: baseline, languageTheme: name, languageThemeIsNew: isNew } = get();
      if (baseline) {
        const { source } = baseline.rules;
        const { rules } = await designLanguage.restore({
          // A theme made for this visit has nothing to go back to: it goes.
          ...(isNew ? {} : { theme: baseline.theme, name }),
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
      if (isNew) {
        await themeApi.removeTheme(name);
        void get().loadFolderConfig();
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
