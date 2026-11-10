import type {
  ArtDirectionGenerateResult,
  ArtDirectionState,
  ArtDirectionSummary,
  BuildArtDirectionBody,
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

/** Where an agent starts: a provider, or a session already started for it (to pick its model). */
export interface AgentStart {
  provider: string;
  /** A session started ahead, so its model could be read and picked. */
  session?: string | undefined;
  model?: string | undefined;
}

/** The art direction stage: the design's art directions, the open one, the image models. */
export interface ArtDirectionSlice {
  /** Every art direction, the most recently changed first; null until read. */
  artDirections: ArtDirectionSummary[] | null;
  /** The one open on the stage; null is the list and the way to start another. */
  artDirectionId: string | null;
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

  /** Open the stage on one art direction, or on the list with `null`/nothing. */
  openArtDirection(id?: string | null): Promise<void>;
  closeArtDirection(): void;
  loadArtDirections(): Promise<ArtDirectionSummary[]>;
  refreshArtDirection(): Promise<void>;
  /** A daemon event: one art direction changed, or one was added or deleted. */
  artDirectionChanged(id: string | undefined): Promise<void>;
  loadArtDirectionModels(): Promise<void>;
  setArtDirectionStep(step: ArtDirectionStage | null): void;
  updateArtDirection(body: UpdateArtDirectionBody): Promise<void>;
  generateArtDirection(body: GenerateArtDirectionBody): Promise<ArtDirectionGenerateResult>;
  /**
   * Begin a new art direction and start `start` on it in the Agent tab — or,
   * with no start, carry on in the session already open.
   */
  beginArtDirection(
    body: Pick<UpdateArtDirectionBody, "origin" | "page">,
    text: string,
    start: AgentStart | null,
  ): Promise<void>;
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
  /** Start an agent in the Agent tab on `text`, and show the tab. */
  runArtDirectionAgent(start: AgentStart, text: string): Promise<boolean>;
  cancelArtDirectionAsk(): void;
  /**
   * Hand the chosen mocks to the agent, then show the board it builds them
   * on, beside the conversation.
   */
  buildArtDirection(body: BuildArtDirectionBody, text: string): Promise<void>;
  /** Show the board the open art direction was built on, keeping its conversation. */
  showArtDirectionBuild(): Promise<void>;
  /** Delete the open art direction and its images, back to the list. */
  deleteArtDirection(): Promise<void>;
  /**
   * Opening an art direction's session brings back where it stands: the art
   * direction itself, or once it is built, the board it was built on.
   */
  followArtDirectionSession(sessionId: string): Promise<void>;
}

let visit = 0;
/** A build waiting on the person to pick an agent: its board is shown once one starts. */
let buildBoardAfterPick: string | null = null;

export const createArtDirectionSlice: StateCreator<CanvasState, [], [], ArtDirectionSlice> = (
  set,
  get,
) => {
  /** The step the person is on, as the card sent with every message names it. */
  const step = (): ArtDirectionStage =>
    get().artDirectionStep ?? get().artDirection?.artDirection.stage ?? "brief";

  const openId = (): string => {
    const id = get().artDirectionId;
    if (!id) throw new Error("No art direction is open.");
    return id;
  };

  /** Show the Agent tab, wider. */
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
    const id = get().artDirectionId;
    if (!id || get().artDirection?.artDirection.agentSession === sessionId) return;
    await artDirection.update(id, { agentSession: sessionId });
    await get().refreshArtDirection();
  }

  /**
   * The board the agent builds on, beside the conversation, so the screens are
   * seen landing. The art direction stays a click away in the Agent tab.
   */
  async function showBuild(boardId: string) {
    visit++;
    set({ view: "boards" });
    await get().selectBoard(boardId);
  }

  async function send(sessionId: string, text: string) {
    await agent.prompt(sessionId, {
      text,
      context: [artDirectionCard(step(), get().artDirectionId ?? undefined)],
    });
  }

  return {
    artDirections: null,
    artDirectionId: null,
    artDirection: null,
    artDirectionModels: null,
    artDirectionModelsProblem: null,
    artDirectionSignedOut: false,
    artDirectionStep: null,
    artDirectionBusy: [],
    artDirectionFailures: {},
    artDirectionPaneWidth: null,
    artDirectionAsk: null,

    async openArtDirection(id = null) {
      const mine = ++visit;
      set({
        view: "art-direction",
        artDirectionId: id,
        artDirectionStep: null,
        artDirectionFailures: {},
        ...(id ? {} : { artDirection: null }),
      });
      const [state] = await Promise.all([
        id ? artDirection.fetch(id) : null,
        get().loadArtDirectionModels(),
        get().loadArtDirections(),
      ]);
      if (mine !== visit) return;
      set({ artDirection: state });
      // Its conversation comes back with it.
      const linked = state?.artDirection.agentSession;
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

    async loadArtDirections() {
      const { artDirections } = await artDirection.list();
      set({ artDirections });
      return artDirections;
    },

    async refreshArtDirection() {
      const id = get().artDirectionId;
      if (!id) return;
      const state = await artDirection.fetch(id);
      if (get().artDirectionId === id) set({ artDirection: state });
    },

    async artDirectionChanged(id) {
      if (get().artDirections !== null) await get().loadArtDirections();
      if (id && id === get().artDirectionId) await get().refreshArtDirection();
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
      await artDirection.update(openId(), body);
      await get().refreshArtDirection();
    },

    async generateArtDirection(body) {
      const id = openId();
      const targets =
        body.directions ?? get().artDirection?.artDirection.directions.map((d) => d.id) ?? [];
      set((s) => ({
        artDirectionBusy: [...s.artDirectionBusy, ...targets],
        artDirectionFailures: Object.fromEntries(
          Object.entries(s.artDirectionFailures).filter(([d]) => !targets.includes(d)),
        ),
      }));
      try {
        const result = await artDirection.generate(id, body);
        if (result.failed.length > 0 && get().artDirectionId === id) {
          set((s) => ({
            artDirectionFailures: {
              ...s.artDirectionFailures,
              ...Object.fromEntries(result.failed.map((f) => [f.direction, f.message])),
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

    async beginArtDirection(body, text, start) {
      const state = await artDirection.create(body);
      set({ artDirectionId: state.id, artDirection: state, artDirectionStep: null });
      void get().loadArtDirections();
      if (start) await get().runArtDirectionAgent(start, text);
      else await get().askArtDirectionAgent(text);
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

    async runArtDirectionAgent(start, text) {
      set({ artDirectionAsk: null });
      showAgent();
      if (start.session) {
        if (start.model) await agent.setModel(start.session, start.model);
        await get().loadAgent();
        await get().selectAgentSession(start.session);
      } else {
        await get().startAgentSession(start.provider);
      }
      const session = liveAgentSession(get());
      if (!session) return false;
      await link(session);
      await send(session, text);
      const board = buildBoardAfterPick;
      buildBoardAfterPick = null;
      if (board) await showBuild(board);
      return true;
    },

    cancelArtDirectionAsk() {
      buildBoardAfterPick = null;
      set({ artDirectionAsk: null });
    },

    async buildArtDirection(body, text) {
      const id = openId();
      const { boardId } = await artDirection.build(id, body);
      await get().refreshArtDirection();
      set({ artDirectionStep: "build" });
      await get().askArtDirectionAgent(text);
      if (get().artDirectionAsk === null) await showBuild(boardId);
      else buildBoardAfterPick = boardId;
    },

    async showArtDirectionBuild() {
      const board = get().artDirection?.artDirection.buildBoard;
      if (board) await showBuild(board);
    },

    async deleteArtDirection() {
      await artDirection.remove(openId());
      set({ artDirectionStep: null, artDirectionFailures: {} });
      await get().openArtDirection(null);
    },

    async followArtDirectionSession(sessionId) {
      if (get().view === "art-direction") return;
      const all =
        get().artDirections ??
        (await get()
          .loadArtDirections()
          .catch(() => []));
      const linked = all.find((a) => a.agentSession === sessionId);
      if (!linked) return;
      // Once built, the conversation is about the screens: it goes with their board.
      if (linked.stage === "build" && linked.buildBoard && get().boards[linked.buildBoard]) {
        if (get().currentBoardId !== linked.buildBoard) await get().selectBoard(linked.buildBoard);
        return;
      }
      await get().openArtDirection(linked.id);
    },
  };
};
