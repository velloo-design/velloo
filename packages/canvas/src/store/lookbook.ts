import type {
  GenerateLookbookBody,
  ImageModels,
  LookbookGenerateResult,
  LookbookRequestBody,
  LookbookState,
  UpdateLookbookBody,
} from "@velloo/protocol";
import type { LookbookStage } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { agent } from "../api/agent.ts";
import { lookbook } from "../api/lookbook.ts";
import { pushToast } from "../toast.ts";
import { liveAgentSession } from "./agent.ts";
import type { CanvasState } from "./index.ts";

/** The lookbook stage: the lookbook itself, the image models, and the step on screen. */
export interface LookbookSlice {
  lookbook: LookbookState | null;
  /** Null until read, or while the daemon isn't signed in (then `lookbookModelsProblem` says why). */
  lookbookModels: ImageModels | null;
  lookbookModelsProblem: string | null;
  /** The models are missing because the daemon isn't signed in (rather than unavailable). */
  lookbookSignedOut: boolean;
  /** The step the person is looking at; follows the lookbook's stage until they pick one. */
  lookbookStep: LookbookStage | null;
  /** Generations this canvas started and is waiting on, by direction. */
  lookbookBusy: string[];

  openLookbook(): Promise<void>;
  closeLookbook(): void;
  refreshLookbook(): Promise<void>;
  loadLookbookModels(): Promise<void>;
  setLookbookStep(step: LookbookStage | null): void;
  updateLookbook(body: UpdateLookbookBody): Promise<void>;
  generateLookbook(body: GenerateLookbookBody): Promise<LookbookGenerateResult>;
  /**
   * Ask the agent for something only it can do (write directions, build). Sent
   * to the Agent tab's session when one is open; otherwise left as a request
   * the next agent reads in `get_lookbook`, and the prompt copied to paste.
   */
  askLookbookAgent(request: LookbookRequestBody, prompt: string): Promise<"sent" | "left">;
}

let visit = 0;

export const createLookbookSlice: StateCreator<CanvasState, [], [], LookbookSlice> = (
  set,
  get,
) => ({
  lookbook: null,
  lookbookModels: null,
  lookbookModelsProblem: null,
  lookbookSignedOut: false,
  lookbookStep: null,
  lookbookBusy: [],

  async openLookbook() {
    const mine = ++visit;
    set({ view: "lookbook", lookbookStep: null });
    const [state] = await Promise.all([lookbook.fetch(), get().loadLookbookModels()]);
    if (mine === visit) set({ lookbook: state });
  },

  closeLookbook() {
    visit++;
    set({ view: "boards" });
  },

  async refreshLookbook() {
    const state = await lookbook.fetch();
    set({ lookbook: state });
  },

  async loadLookbookModels() {
    try {
      const r = await lookbook.models();
      set({
        lookbookModels: r.models,
        lookbookModelsProblem: r.models ? null : (r.problem ?? null),
      });
    } catch (error) {
      set({ lookbookModels: null, lookbookModelsProblem: (error as Error).message });
    }
  },

  setLookbookStep(step) {
    set({ lookbookStep: step });
  },

  async updateLookbook(body) {
    await lookbook.update(body);
    await get().refreshLookbook();
  },

  async generateLookbook(body) {
    const targets = body.directions ?? get().lookbook?.lookbook.directions.map((d) => d.id) ?? [];
    set((s) => ({ lookbookBusy: [...s.lookbookBusy, ...targets] }));
    try {
      const result = await lookbook.generate(body);
      // The balance went down; the models' lock state can change with it.
      void get().loadLookbookModels();
      return result;
    } finally {
      set((s) => {
        const busy = [...s.lookbookBusy];
        for (const t of targets) busy.splice(busy.indexOf(t), 1);
        return { lookbookBusy: busy };
      });
      await get().refreshLookbook();
    }
  },

  async askLookbookAgent(request, prompt) {
    const session = liveAgentSession(get());
    if (session) {
      await agent.prompt(session, { text: prompt });
      return "sent";
    }
    await lookbook.request(request);
    await get().refreshLookbook();
    try {
      await navigator.clipboard.writeText(prompt);
      pushToast({
        kind: "success",
        message: "Left for your agent, and the prompt is copied: paste it to your coding agent.",
      });
    } catch {
      pushToast({
        kind: "info",
        message: "Left for your agent: it sees the request the next time it reads the lookbook.",
      });
    }
    return "left";
  },
});
