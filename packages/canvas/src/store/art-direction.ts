import type {
  ArtDirectionGenerateResult,
  ArtDirectionState,
  GenerateArtDirectionBody,
  ImageModels,
  UpdateArtDirectionBody,
} from "@velloo/protocol";
import type { ArtDirectionStage } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { agent } from "../api/agent.ts";
import { artDirection } from "../api/art-direction.ts";
import { liveAgentSession } from "./agent.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";

/** The art direction stage: the art direction itself, the image models, and the step on screen. */
export interface ArtDirectionSlice {
  artDirection: ArtDirectionState | null;
  /** Null until read, or while the daemon isn't signed in (then `artDirectionModelsProblem` says why). */
  artDirectionModels: ImageModels | null;
  artDirectionModelsProblem: string | null;
  /** The models are missing because the daemon isn't signed in (rather than unavailable). */
  artDirectionSignedOut: boolean;
  /** The step the person is looking at; follows the art direction's stage until they pick one. */
  artDirectionStep: ArtDirectionStage | null;
  /** Generations this canvas started and is waiting on, by direction. */
  artDirectionBusy: string[];

  openArtDirection(): Promise<void>;
  closeArtDirection(): void;
  refreshArtDirection(): Promise<void>;
  loadArtDirectionModels(): Promise<void>;
  setArtDirectionStep(step: ArtDirectionStage | null): void;
  updateArtDirection(body: UpdateArtDirectionBody): Promise<void>;
  generateArtDirection(body: GenerateArtDirectionBody): Promise<ArtDirectionGenerateResult>;
  /**
   * A prompt waiting for the person to pick which agent runs it: set when
   * they ask for something only an agent can do and no Agent-tab session is
   * open. The picker dialog reads it.
   */
  artDirectionAsk: string | null;
  /**
   * Ask the agent for something only it can do (write the brief and the
   * directions, revise one, build a mock). Sent straight to the Agent tab's
   * session when one is open; otherwise the person picks an agent first.
   */
  askArtDirectionAgent(prompt: string): Promise<void>;
  /** Start `provider` in the Agent tab on `prompt`, and show the tab. */
  runArtDirectionAgent(provider: string, prompt: string): Promise<boolean>;
  cancelArtDirectionAsk(): void;
  /** Delete the art direction and its images, back to the start page. */
  resetArtDirection(): Promise<void>;
}

let visit = 0;

export const createArtDirectionSlice: StateCreator<CanvasState, [], [], ArtDirectionSlice> = (
  set,
  get,
) => ({
  artDirection: null,
  artDirectionModels: null,
  artDirectionModelsProblem: null,
  artDirectionSignedOut: false,
  artDirectionStep: null,
  artDirectionBusy: [],
  artDirectionAsk: null,

  async openArtDirection() {
    const mine = ++visit;
    set({ view: "art-direction", artDirectionStep: null });
    const [state] = await Promise.all([artDirection.fetch(), get().loadArtDirectionModels()]);
    if (mine === visit) set({ artDirection: state });
  },

  closeArtDirection() {
    visit++;
    set({ view: "boards" });
  },

  async refreshArtDirection() {
    const state = await artDirection.fetch();
    set({ artDirection: state });
  },

  async loadArtDirectionModels() {
    try {
      const r = await artDirection.models();
      set({
        artDirectionModels: r.models,
        artDirectionModelsProblem: r.models ? null : (r.problem ?? null),
      });
    } catch (error) {
      set({ artDirectionModels: null, artDirectionModelsProblem: (error as Error).message });
    }
  },

  setArtDirectionStep(step) {
    set({ artDirectionStep: step });
  },

  async updateArtDirection(body) {
    await artDirection.update(body);
    await get().refreshArtDirection();
  },

  async generateArtDirection(body) {
    const targets =
      body.directions ?? get().artDirection?.artDirection.directions.map((d) => d.id) ?? [];
    set((s) => ({ artDirectionBusy: [...s.artDirectionBusy, ...targets] }));
    try {
      const result = await artDirection.generate(body);
      // The balance went down; the models' lock state can change with it.
      void get().loadArtDirectionModels();
      return result;
    } finally {
      set((s) => {
        const busy = [...s.artDirectionBusy];
        for (const t of targets) busy.splice(busy.indexOf(t), 1);
        return { artDirectionBusy: busy };
      });
      await get().refreshArtDirection();
    }
  },

  async askArtDirectionAgent(prompt) {
    const session = liveAgentSession(get());
    if (!session) {
      if (get().agentProviders === null) await get().loadAgent();
      set({ artDirectionAsk: prompt });
      return;
    }
    await agent.prompt(session, { text: prompt });
    set((s) => ({ artDirectionAsk: null, rightTab: "agent", ...revealPane(s, "right") }));
  },

  async runArtDirectionAgent(provider, prompt) {
    set({ artDirectionAsk: null });
    await get().startAgentSession(provider);
    const session = liveAgentSession(get());
    if (!session) return false;
    set((s) => ({ rightTab: "agent", ...revealPane(s, "right") }));
    await agent.prompt(session, { text: prompt });
    return true;
  },

  cancelArtDirectionAsk() {
    set({ artDirectionAsk: null });
  },

  async resetArtDirection() {
    await artDirection.reset();
    set({ artDirectionStep: null });
    await get().refreshArtDirection();
  },
});
