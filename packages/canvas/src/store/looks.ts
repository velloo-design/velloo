import type { LookSummary } from "@velloo/protocol";
import type { SketchbookDirection } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { theme as themeApi } from "../api.ts";
import { finishLook } from "../components/Sketchbook/prompts.ts";
import { liveAgentSession } from "./agent.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";

/**
 * The design's Looks: each theme with its sidecar of imagery, rules and
 * origin. The Looks rail lists them all and shows one; its token controls stay
 * on the board's own, so what is being edited is always what is on screen.
 */
export interface LooksSlice {
  /** Every Look, the default first; null until read. */
  looks: LookSummary[] | null;
  /**
   * The Look the rail shows, when it isn't the board's: its imagery and rules
   * can be read and edited from any board, its tokens only from one on it.
   */
  lookFocus: string | null;
  refreshLooks(): Promise<void>;
  focusLook(name: string | null): void;
  /**
   * Make a Look from a sketchbook direction. One with proposed tokens takes
   * them and opens on the language stage as a draft, to refine or cancel.
   * Otherwise the sketchbook's agent, when one is running, is asked to set its
   * tokens, rules and imagery from the images, or the Look opens in the rail
   * as it was made.
   */
  makeLook(
    sketchbookId: string,
    direction: SketchbookDirection,
  ): Promise<{ name: string; draft: boolean }>;
}

export const createLooksSlice: StateCreator<CanvasState, [], [], LooksSlice> = (set, get) => ({
  looks: null,
  lookFocus: null,

  async refreshLooks() {
    const looks = await themeApi.looks();
    set((s) => ({
      looks,
      // A Look renamed or removed elsewhere stops being the one shown.
      lookFocus: s.lookFocus && looks.some((l) => l.name === s.lookFocus) ? s.lookFocus : null,
    }));
  },

  focusLook(name) {
    set({ lookFocus: name === get().themeName ? null : name });
  },

  async makeLook(sketchbookId, direction) {
    const made = await themeApi.updateLook({
      fromSketchbook: { sketchbook: sketchbookId, direction: direction.id, from: get().themeName },
    });
    await get().refreshLooks();
    if (direction.proposal && made.created) {
      get().closeSketchbook();
      await get().draftTheme(made.name);
      return { name: made.name, draft: true };
    }
    if (liveAgentSession(get())) {
      await get().askSketchbookAgent(finishLook(direction.title, made.name));
      return { name: made.name, draft: false };
    }
    get().closeSketchbook();
    set((s) => ({ rightTab: "theme", lookFocus: made.name, ...revealPane(s, "right") }));
    return { name: made.name, draft: false };
  },
});
