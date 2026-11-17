import type {
  BuildSketchbookBody,
  GenerateSketchbookBody,
  ImageModels,
  IntentPrice,
  ReferencePatch,
  SketchbookGenerateResult,
  SketchbookLinks,
  SketchbookState,
  SketchbookSummary,
  UpdateSketchbookBody,
} from "@velloo/protocol";
import type { AgentContextCard } from "@velloo/protocol/agent";
import type { SketchbookPage, SketchbookStage, SketchbookSubject } from "@velloo/schema";
import type { StateCreator } from "zustand";
import { sketchbookCard } from "../agent-context.ts";
import { agent } from "../api/agent.ts";
import { sketchbook } from "../api/sketchbook.ts";
import { START_FROM_APP } from "../components/Sketchbook/prompts.ts";
import { toastError } from "../toast.ts";
import { type AgentLaunch, liveAgentSession } from "./agent.ts";
import type { CanvasState } from "./index.ts";
import { revealPane } from "./modes.ts";

/**
 * How wide the Agent tab opens beside the sketchbook: the conversation is
 * half the work there, and its questions run long.
 */
const AGENT_WIDTH = 480;

/** Where an agent starts: a provider, or a session already started for it (to pick its model). */
/** The sketchbook stage: the design's sketchbooks, the open one, the image models. */
export interface SketchbookSlice {
  /** Every sketchbook, the most recently changed first; null until read. */
  sketchbooks: SketchbookSummary[] | null;
  /** The one open on the stage; null is the home (or, with `sketchbookStart`, a start page). */
  sketchbookId: string | null;
  /**
   * While no sketchbook is open: the flow whose start page is shown, where
   * the person says what they want before an agent starts. Null is the home.
   */
  sketchbookStart: SketchbookSubject | null;
  sketchbook: SketchbookState | null;
  /** Null until read, or while the daemon isn't signed in (then `sketchbookModelsProblem` says why). */
  sketchbookModels: ImageModels | null;
  sketchbookModelsProblem: string | null;
  /** The kinds of image the cloud draws for a sketchbook; empty until read. */
  sketchbookKinds: IntentPrice[];
  /** The models are missing because the daemon isn't signed in (rather than unavailable). */
  sketchbookSignedOut: boolean;
  /** The step the person is looking at; follows the sketchbook's stage until they pick one. */
  sketchbookStep: SketchbookStage | null;
  /** Generations this canvas started and is waiting on, as `kind:direction`. */
  sketchbookBusy: string[];
  /** Why the last draw for a direction failed, until it is drawn again. */
  sketchbookFailures: Record<string, string>;
  /** The Agent tab's width before the sketchbook widened it, to give back on close. */
  sketchbookPaneWidth: number | null;

  /** Open the stage on one sketchbook, or on the home with `null`/nothing. */
  openSketchbook(id?: string | null): Promise<void>;
  /**
   * Open the start page of a flow: "page" finds a look for a page, "look"
   * explores palettes and type. Nothing is created until the person starts.
   * From the language stage it leaves the stage first, keeping its edits as Done does.
   */
  startSketchbook(subject: SketchbookSubject): Promise<void>;
  closeSketchbook(): void;
  loadSketchbooks(): Promise<SketchbookSummary[]>;
  refreshSketchbook(): Promise<void>;
  /** A daemon event: one sketchbook changed, or one was added or deleted. */
  sketchbookChanged(id: string | undefined): Promise<void>;
  loadSketchbookModels(): Promise<void>;
  setSketchbookStep(step: SketchbookStage | null): void;
  updateSketchbook(body: UpdateSketchbookBody): Promise<void>;
  generateSketchbook(body: GenerateSketchbookBody): Promise<SketchbookGenerateResult>;
  /**
   * Begin a new sketchbook with the references picked on its start page, and
   * start `start` on it in the Agent tab — or, with no start, carry on in the
   * session already open.
   */
  beginSketchbook(
    body: Pick<UpdateSketchbookBody, "origin" | "page" | "subject">,
    text: string,
    start: AgentLaunch | null,
    references?: ReferencePatch[],
  ): Promise<void>;
  /**
   * A message waiting for the person to pick which agent runs it: set when
   * they ask for something only an agent can do and no Agent-tab session is
   * open. The picker dialog reads it.
   */
  sketchbookAsk: string | null;
  /**
   * The cards a waiting ask goes with, when it isn't about the open sketchbook
   * (a Restyle or Recompose from a frame); null sends the sketchbook's card.
   */
  sketchbookAskCards: AgentContextCard[] | null;
  /**
   * Ask the agent for something only it can do (write the brief and the
   * directions, revise one, design screens from the chosen images). Sent straight to the Agent tab's
   * session when one is open; otherwise the person picks an agent first. The
   * message is one line: the sketchbook card sent with it carries the rest.
   */
  askSketchbookAgent(text: string, cards?: AgentContextCard[] | null): Promise<void>;
  /**
   * Ask an agent for work on the boards (Restyle, Recompose): in the session
   * of the sketchbook the card names when it is running, else the one open in
   * the Agent tab, else the person picks one. The card carries the work; the text is the person's one line.
   */
  askAgentAbout(text: string, card: AgentContextCard): Promise<void>;
  /** What each screen and board came from; null until read. */
  sketchbookLinks: SketchbookLinks | null;
  loadSketchbookLinks(): Promise<void>;
  /** Start a sketchbook redesigning `page` (a screen on the canvas), open it, and ask the agent to begin. */
  exploreLooksFor(page: SketchbookPage): Promise<void>;
  /** Start an agent in the Agent tab on `text`, and show the tab. */
  runSketchbookAgent(start: AgentLaunch, text: string): Promise<boolean>;
  cancelSketchbookAsk(): void;
  /**
   * Hand the chosen images to the agent to design screens from, then show
   * the board they land on, beside the conversation.
   */
  buildSketchbook(body: BuildSketchbookBody, text: string): Promise<void>;
  /**
   * Show a board the open sketchbook's screens are on (by default its first
   * chosen direction's), keeping its conversation.
   */
  showSketchbookBuild(boardId?: string): Promise<void>;
  /** Delete the open sketchbook and its images, back to the list. */
  deleteSketchbook(): Promise<void>;
  /**
   * Opening a sketchbook's session brings back where it stands: the sketchbook
   * itself, or once it is built, the board it was built on.
   */
  followSketchbookSession(sessionId: string): Promise<void>;
}

let visit = 0;
/** A build waiting on the person to pick an agent: its board is shown once one starts. */
let buildBoardAfterPick: string | null = null;

export const createSketchbookSlice: StateCreator<CanvasState, [], [], SketchbookSlice> = (
  set,
  get,
) => {
  /** The step the person is on, as the card sent with every message names it. */
  const step = (): SketchbookStage =>
    get().sketchbookStep ?? get().sketchbook?.sketchbook.stage ?? "brief";

  const openId = (): string => {
    const id = get().sketchbookId;
    if (!id) throw new Error("No sketchbook is open.");
    return id;
  };

  /** Show the Agent tab, wider beside the sketchbook. */
  function showAgent() {
    const widen = get().view === "sketchbook";
    set((s) => ({
      rightTab: "agent",
      ...revealPane(s, "right"),
      ...(widen && s.rightPaneWidth < AGENT_WIDTH
        ? { rightPaneWidth: AGENT_WIDTH, sketchbookPaneWidth: s.rightPaneWidth }
        : {}),
    }));
  }

  /** Remember which session runs the sketchbook, so each can bring the other back. */
  async function link(sessionId: string) {
    const id = get().sketchbookId;
    if (!id || get().sketchbook?.sketchbook.agentSession === sessionId) return;
    await sketchbook.update(id, { agentSession: sessionId });
    await get().refreshSketchbook();
  }

  /**
   * The board the agent builds on, beside the conversation, so the screens are
   * seen landing. The sketchbook stays a click away in the Agent tab.
   */
  async function showBuild(boardId: string) {
    visit++;
    set({ view: "boards" });
    await get().selectBoard(boardId);
  }

  async function send(sessionId: string, text: string) {
    const cards = get().sketchbookAskCards;
    set({ sketchbookAskCards: null });
    if (!cards) await link(sessionId);
    await agent.prompt(sessionId, {
      text,
      context: cards ?? [sketchbookCard(step(), get().sketchbookId ?? undefined)],
    });
  }

  return {
    sketchbooks: null,
    sketchbookId: null,
    sketchbookStart: null,
    sketchbook: null,
    sketchbookModels: null,
    sketchbookModelsProblem: null,
    sketchbookKinds: [],
    sketchbookSignedOut: false,
    sketchbookStep: null,
    sketchbookBusy: [],
    sketchbookFailures: {},
    sketchbookPaneWidth: null,
    sketchbookAsk: null,
    sketchbookAskCards: null,
    sketchbookLinks: null,

    async openSketchbook(id = null) {
      const mine = ++visit;
      set({
        view: "sketchbook",
        sketchbookId: id,
        sketchbookStart: null,
        sketchbookStep: null,
        sketchbookFailures: {},
        ...(id ? {} : { sketchbook: null }),
      });
      const [state] = await Promise.all([
        id ? sketchbook.fetch(id) : null,
        get().loadSketchbookModels(),
        get().loadSketchbooks(),
      ]);
      if (mine !== visit) return;
      set({ sketchbook: state });
      // Its conversation comes back with it.
      const linked = state?.sketchbook.agentSession;
      if (!linked) return;
      if (get().agentProviders === null) await get().loadAgent();
      if (mine !== visit || !get().agentSessions.some((s) => s.id === linked)) return;
      if (get().agentActiveSessionId !== linked) await get().selectAgentSession(linked);
      showAgent();
    },

    async startSketchbook(subject) {
      if (get().view === "language") await get().finishLanguage();
      visit++;
      set({
        view: "sketchbook",
        sketchbookId: null,
        sketchbook: null,
        sketchbookStart: subject,
        sketchbookStep: null,
        sketchbookFailures: {},
      });
      await Promise.all([get().loadSketchbookModels(), get().loadSketchbooks()]);
    },

    closeSketchbook() {
      visit++;
      const linked = get().sketchbook?.sketchbook.agentSession;
      set((s) => ({
        view: "boards",
        // The Agent tab goes back to its list, as it was before the sketchbook.
        ...(linked && s.agentActiveSessionId === linked ? { agentActiveSessionId: null } : {}),
        ...(s.sketchbookPaneWidth !== null
          ? { rightPaneWidth: s.sketchbookPaneWidth, sketchbookPaneWidth: null }
          : {}),
      }));
    },

    async loadSketchbooks() {
      const { sketchbooks } = await sketchbook.list();
      set({ sketchbooks });
      return sketchbooks;
    },

    async refreshSketchbook() {
      const id = get().sketchbookId;
      if (!id) return;
      const state = await sketchbook.fetch(id);
      if (get().sketchbookId !== id) return;
      // A draw the server reports is the server's to end, direction by
      // direction; this canvas's own marker only bridges until it does, or
      // the first direction done would keep its tile spinning for the rest.
      const acknowledged = new Set(state.pending.map((p) => `${p.kind}:${p.direction}`));
      set((s) => ({
        sketchbook: state,
        sketchbookBusy: s.sketchbookBusy.filter((b) => !acknowledged.has(b)),
      }));
    },

    async sketchbookChanged(id) {
      if (get().sketchbookLinks !== null)
        void get()
          .loadSketchbookLinks()
          .catch(() => {});
      if (get().sketchbooks !== null) await get().loadSketchbooks();
      if (id && id === get().sketchbookId) await get().refreshSketchbook();
    },

    async loadSketchbookModels() {
      try {
        const r = await sketchbook.models();
        set({
          sketchbookModels: r.models,
          sketchbookModelsProblem: r.models ? null : (r.problem ?? null),
          ...(r.kinds ? { sketchbookKinds: r.kinds } : {}),
        });
      } catch (error) {
        set({ sketchbookModels: null, sketchbookModelsProblem: (error as Error).message });
      }
    },

    setSketchbookStep(next) {
      set({ sketchbookStep: next });
    },

    async updateSketchbook(body) {
      await sketchbook.update(openId(), body);
      await get().refreshSketchbook();
    },

    async generateSketchbook(body) {
      const id = openId();
      const targets =
        body.directions ?? get().sketchbook?.sketchbook.directions.map((d) => d.id) ?? [];
      set((s) => ({
        sketchbookBusy: [...s.sketchbookBusy, ...targets.map((t) => `${body.kind}:${t}`)],
        sketchbookFailures: Object.fromEntries(
          Object.entries(s.sketchbookFailures).filter(([d]) => !targets.includes(d)),
        ),
      }));
      try {
        const result = await sketchbook.generate(id, body);
        if (result.failed.length > 0 && get().sketchbookId === id) {
          set((s) => ({
            sketchbookFailures: {
              ...s.sketchbookFailures,
              ...Object.fromEntries(result.failed.map((f) => [f.direction, f.message])),
            },
          }));
        }
        // The balance went down; the models' lock state can change with it.
        void get().loadSketchbookModels();
        return result;
      } finally {
        set((s) => {
          const busy = [...s.sketchbookBusy];
          for (const t of targets) {
            const at = busy.indexOf(`${body.kind}:${t}`);
            if (at >= 0) busy.splice(at, 1);
          }
          return { sketchbookBusy: busy };
        });
        await get().refreshSketchbook();
      }
    },

    async beginSketchbook(body, text, start, references = []) {
      const state = await sketchbook.create(body);
      set({
        sketchbookId: state.id,
        sketchbook: state,
        sketchbookStart: null,
        sketchbookStep: null,
      });
      if (references.length > 0) {
        // The sketchbook starts either way: the agent can be given a page that failed again.
        await sketchbook
          .update(state.id, { references })
          .catch((err) => toastError(err, "Could not add the references"));
        await get().refreshSketchbook();
      }
      void get().loadSketchbooks();
      if (start) await get().runSketchbookAgent(start, text);
      else await get().askSketchbookAgent(text);
    },

    async askSketchbookAgent(text, cards = null) {
      set({ sketchbookAskCards: cards });
      const session = liveAgentSession(get());
      if (!session) {
        if (get().agentProviders === null) await get().loadAgent();
        set({ sketchbookAsk: text });
        return;
      }
      set({ sketchbookAsk: null });
      showAgent();
      await send(session, text);
    },

    async askAgentAbout(text, card) {
      if (get().agentProviders === null) await get().loadAgent();
      const from = card.ref.sketchbook;
      const books = from ? (get().sketchbooks ?? (await get().loadSketchbooks())) : [];
      const session = books.find((b) => b.id === from)?.agentSession;
      const live =
        session && liveAgentSession({ ...get(), agentActiveSessionId: session }) === session;
      if (live && get().agentActiveSessionId !== session) await get().selectAgentSession(session);
      await get().askSketchbookAgent(text, [card]);
    },

    async loadSketchbookLinks() {
      set({ sketchbookLinks: await sketchbook.links() });
    },

    async exploreLooksFor(page) {
      const state = await sketchbook.create({ origin: "existing", page });
      await get().openSketchbook(state.id);
      await get().askSketchbookAgent(START_FROM_APP);
    },

    async runSketchbookAgent(start, text) {
      set({ sketchbookAsk: null });
      showAgent();
      await get().launchAgent(start);
      const session = liveAgentSession(get());
      if (!session) return false;
      await send(session, text);
      const board = buildBoardAfterPick;
      buildBoardAfterPick = null;
      if (board) await showBuild(board);
      return true;
    },

    cancelSketchbookAsk() {
      buildBoardAfterPick = null;
      set({ sketchbookAsk: null, sketchbookAskCards: null });
    },

    async buildSketchbook(body, text) {
      const id = openId();
      const { boardId } = await sketchbook.build(id, body);
      await get().refreshSketchbook();
      set({ sketchbookStep: "screens" });
      await get().askSketchbookAgent(text);
      if (get().sketchbookAsk === null) await showBuild(boardId);
      else buildBoardAfterPick = boardId;
    },

    async showSketchbookBuild(boardId) {
      const file = get().sketchbook?.sketchbook;
      const board =
        boardId ??
        (file
          ? (file.buildBoards[file.chosen[0]?.direction ?? ""] ??
            Object.values(file.buildBoards)[0])
          : undefined);
      if (board) await showBuild(board);
    },

    async deleteSketchbook() {
      await sketchbook.remove(openId());
      set({ sketchbookStep: null, sketchbookFailures: {} });
      await get().openSketchbook(null);
    },

    async followSketchbookSession(sessionId) {
      if (get().view === "sketchbook") return;
      const all =
        get().sketchbooks ??
        (await get()
          .loadSketchbooks()
          .catch(() => []));
      const linked = all.find((a) => a.agentSession === sessionId);
      if (!linked) return;
      // Once the screens are started, the conversation is about them: it goes with their board.
      const built = Object.values(linked.buildBoards).filter((b) => get().boards[b]);
      if (linked.stage === "screens" && built.length > 0) {
        const current = get().currentBoardId;
        if (!current || !built.includes(current)) await get().selectBoard(built[0] as string);
        return;
      }
      await get().openSketchbook(linked.id);
    },
  };
};
