import type {
  ArtDirectionGenerateResult,
  ArtDirectionState,
  GenerateArtDirectionBody,
  ImageModels,
  UpdateArtDirectionBody,
} from "@velloo/protocol";
import type { ArtDirectionStage } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { artDirectionCard } from "../agent-context.ts";
import { agent } from "../api/agent.ts";
import { artDirection } from "../api/art-direction.ts";
import { liveAgentSession } from "./agent.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";

/**
 * How wide the Agent tab opens beside the art direction: the conversation is
 * half the work there, and its questions run long.
 */
const AGENT_WIDTH = 480;

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
  /** Why the last draw for a direction failed, until it is drawn again. */
  artDirectionFailures: Record<string, string>;
  /** The Agent tab's width before the art direction widened it, to give back on close. */
  artDirectionPaneWidth: number | null;

  openArtDirection(): Promise<void>;
  closeArtDirection(): void;
  refreshArtDirection(): Promise<void>;
  loadArtDirectionModels(): Promise<void>;
  setArtDirectionStep(step: ArtDirectionStage | null): void;
  updateArtDirection(body: UpdateArtDirectionBody): Promise<void>;
  generateArtDirection(body: GenerateArtDirectionBody): Promise<ArtDirectionGenerateResult>;
  /**
   * A message waiting for the person to pick which agent runs it: set when
   * they ask for something only an agent can do and no Agent-tab session is
   * open. The picker dialog reads it.
   */
  artDirectionAsk: string | null;
  /**
   * Ask the agent for something only it can do (write the brief and the
   * directions, revise one, build a mock). Sent straight to the Agent tab's
   * session when one is open; otherwise the person picks an agent first. The
   * message is one line: the art direction card sent with it carries the rest.
   */
  askArtDirectionAgent(text: string): Promise<void>;
  /** Start `provider` in the Agent tab on `text`, and show the tab. */
  runArtDirectionAgent(provider: string, text: string): Promise<boolean>;
  cancelArtDirectionAsk(): void;
  /** Delete the art direction and its images, back to the start page. */
  resetArtDirection(): Promise<void>;
  /** Opening the art direction's own session brings the art direction back. */
  followArtDirectionSession(sessionId: string): Promise<void>;
}

let visit = 0;

export const createArtDirectionSlice: StateCreator<CanvasState, [], [], ArtDirectionSlice> = (
  set,
  get,
) => {
  /** The step the person is on, as the card sent with every message names it. */
  const step = (): ArtDirectionStage =>
    get().artDirectionStep ?? get().artDirection?.artDirection.stage ?? "brief";

  /** Show the Agent tab, wider, beside the art direction. */
  function showAgent() {
    set((s) => ({
      rightTab: "agent",
      ...revealPane(s, "right"),
      ...(s.rightPaneWidth < AGENT_WIDTH
        ? { rightPaneWidth: AGENT_WIDTH, artDirectionPaneWidth: s.rightPaneWidth }
        : {}),
    }));
  }

  /** Remember which session runs the art direction, so each can bring the other back. */
  async function link(sessionId: string) {
    if (get().artDirection?.artDirection.agentSession === sessionId) return;
    await artDirection.update({ agentSession: sessionId });
    await get().refreshArtDirection();
  }

  async function send(sessionId: string, text: string) {
    await agent.prompt(sessionId, { text, context: [artDirectionCard(step())] });
  }

  return {
    artDirection: null,
    artDirectionModels: null,
    artDirectionModelsProblem: null,
    artDirectionSignedOut: false,
    artDirectionStep: null,
    artDirectionBusy: [],
    artDirectionFailures: {},
    artDirectionPaneWidth: null,
    artDirectionAsk: null,

    async openArtDirection() {
      const mine = ++visit;
      set({ view: "art-direction", artDirectionStep: null });
      const [state] = await Promise.all([artDirection.fetch(), get().loadArtDirectionModels()]);
      if (mine !== visit) return;
      set({ artDirection: state });
      // Its conversation comes back with it.
      const linked = state.artDirection.agentSession;
      if (!linked) return;
      if (get().agentProviders === null) await get().loadAgent();
      if (mine !== visit || !get().agentSessions.some((s) => s.id === linked)) return;
      if (get().agentActiveSessionId !== linked) await get().selectAgentSession(linked);
      showAgent();
    },

    closeArtDirection() {
      visit++;
      const linked = get().artDirection?.artDirection.agentSession;
      set((s) => ({
        view: "boards",
        // The Agent tab goes back to its list, as it was before the art direction.
        ...(linked && s.agentActiveSessionId === linked ? { agentActiveSessionId: null } : {}),
        ...(s.artDirectionPaneWidth !== null
          ? { rightPaneWidth: s.artDirectionPaneWidth, artDirectionPaneWidth: null }
          : {}),
      }));
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

    setArtDirectionStep(next) {
      set({ artDirectionStep: next });
    },

    async updateArtDirection(body) {
      await artDirection.update(body);
      await get().refreshArtDirection();
    },

    async generateArtDirection(body) {
      const targets =
        body.directions ?? get().artDirection?.artDirection.directions.map((d) => d.id) ?? [];
      set((s) => ({
        artDirectionBusy: [...s.artDirectionBusy, ...targets],
        artDirectionFailures: Object.fromEntries(
          Object.entries(s.artDirectionFailures).filter(([d]) => !targets.includes(d)),
        ),
      }));
      try {
        const result = await artDirection.generate(body);
        if (result.failed.length > 0) {
          set((s) => ({
            artDirectionFailures: {
              ...s.artDirectionFailures,
              ...Object.fromEntries(
                result.failed
                  .filter((f) => f.direction !== "*")
                  .map((f) => [f.direction, f.message]),
              ),
            },
          }));
        }
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

    async askArtDirectionAgent(text) {
      const session = liveAgentSession(get());
      if (!session) {
        if (get().agentProviders === null) await get().loadAgent();
        set({ artDirectionAsk: text });
        return;
      }
      set({ artDirectionAsk: null });
      showAgent();
      await link(session);
      await send(session, text);
    },

    async runArtDirectionAgent(provider, text) {
      set({ artDirectionAsk: null });
      showAgent();
      await get().startAgentSession(provider);
      const session = liveAgentSession(get());
      if (!session) return false;
      await link(session);
      await send(session, text);
      return true;
    },

    cancelArtDirectionAsk() {
      set({ artDirectionAsk: null });
    },

    async resetArtDirection() {
      await artDirection.reset();
      set({ artDirectionStep: null, artDirectionFailures: {} });
      await get().refreshArtDirection();
    },

    async followArtDirectionSession(sessionId) {
      if (get().view === "art-direction") return;
      const state = get().artDirection ?? (await artDirection.fetch().catch(() => null));
      if (state?.artDirection.agentSession !== sessionId) return;
      await get().openArtDirection();
    },
  };
};
