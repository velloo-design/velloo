import type { AgentContextCard } from "@velloo/protocol/agent";
import type { Board, CommentThread, Node, Screen } from "@velloo/schema";
import type { CardStaleness } from "./components/Agent/context-cards.tsx";
import { selectedNode } from "./store/selection.ts";
import type { CanvasNoteEntry, Selection } from "./store/types.ts";

/**
 * Canvas context as agent cards: what the canvas suggests attaching from where
 * the person is, the cards a comment thread becomes, and whether a card made
 * earlier still points at what it named.
 */

/** A node as a person would name it: its id, else its component, else its text. */
function nodeName(node: Node): string {
  const record = node as Record<string, unknown>;
  if (typeof record.$id === "string") return record.$id;
  if (typeof record.$ref === "string") return record.$ref.split(".").pop() ?? record.$ref;
  if (typeof record.$snippet === "string") return record.$snippet;
  if (typeof record.$text === "string") return `“${record.$text.slice(0, 24)}”`;
  return "Node";
}

const crumbs = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" › ");

interface Where {
  board: Board | undefined;
  /** The open board's notes, offered last. */
  notes?: CanvasNoteEntry[];
  screens: Record<string, Screen>;
  selection: Selection | null;
  currentScreenId: string | null;
}

/** What the canvas offers to attach right now: the board, the frame in view, the node selected, a preview. */
export function suggestedCards({
  board,
  screens,
  selection,
  currentScreenId,
  notes = [],
}: Where): AgentContextCard[] {
  if (!board) return [];
  const cards: AgentContextCard[] = [];
  const screenId = selection?.screenId ?? currentScreenId;
  const frame = screenId ? board.frames.find((f) => f.screen === screenId) : undefined;
  const screen = screenId ? screens[screenId] : undefined;
  const node = selection ? selectedNode(screens, selection) : null;
  if (node && selection && screen) {
    cards.push({
      kind: "node",
      ref: {
        boardId: board.id,
        screenId: screen.id,
        path: selection.path,
        ...(frame ? { frameId: frame.id } : {}),
      },
      label: crumbs(board.name, screen.name, nodeName(node)),
    });
  }
  if (frame && screen) {
    cards.push({
      kind: "frame",
      ref: { boardId: board.id, frameId: frame.id, screenId: screen.id },
      label: crumbs(board.name, `${screen.name} frame`),
    });
    cards.push({
      kind: "preview",
      ref: { boardId: board.id, frameId: frame.id, screenId: screen.id },
      label: crumbs(board.name, `${screen.name} preview`),
    });
  }
  cards.push({ kind: "board", ref: { boardId: board.id }, label: board.name });
  for (const note of notes) {
    const words = note.body
      .replace(/[#*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!words) continue;
    cards.push({
      kind: "note",
      ref: { boardId: board.id, noteId: note.id },
      label: crumbs(board.name, `Note “${words.length > 32 ? `${words.slice(0, 31)}…` : words}”`),
    });
  }
  return cards;
}

/** Where a comment points, as a breadcrumb. */
function commentTarget(
  thread: CommentThread,
  board: Board | undefined,
  screens: Record<string, Screen>,
): string {
  const anchor = thread.anchor;
  const boardName = board?.name ?? thread.boardId;
  if (!anchor || anchor.kind === "board") return boardName;
  const screen = screens[anchor.screenId];
  const node =
    screen && Array.isArray(anchor.locator)
      ? selectedNode(screens, { screenId: anchor.screenId, path: anchor.locator.join(".") })
      : null;
  const named =
    typeof anchor.locator === "string"
      ? anchor.locator.replace(/^@/, "")
      : node
        ? nodeName(node)
        : undefined;
  return crumbs(boardName, screen?.name ?? anchor.screenId, named);
}

/**
 * The card a comment becomes. `messageId` picks the message to carry — a new
 * reviewer reply rather than the thread's opening — and defaults to the first.
 */
export function commentCard(
  thread: CommentThread,
  board: Board | undefined,
  screens: Record<string, Screen>,
  messageId?: string,
): AgentContextCard {
  const message =
    thread.messages.find((m) => m.id === messageId && !m.deletedAt) ??
    thread.messages.find((m) => !m.deletedAt);
  return {
    kind: "comment",
    ref: {
      boardId: thread.boardId,
      threadId: thread.id,
      ...(message ? { messageId: message.id } : {}),
      ...(thread.anchor?.kind === "node" ? { screenId: thread.anchor.screenId } : {}),
    },
    label: commentTarget(thread, board, screens),
    detail: (message?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
    author:
      message?.author.displayName ??
      (message?.author.kind === "agent"
        ? "Agent"
        : message?.author.kind === "reviewer"
          ? "Reviewer"
          : "You"),
  };
}

/**
 * Whether a card still names what it did. Only what the canvas has loaded can
 * be judged; anything else is left alone rather than guessed stale.
 */
export function cardStaleness(
  card: AgentContextCard,
  state: {
    boards: Record<string, Board>;
    screens: Record<string, Screen>;
    threads: Record<string, CommentThread | null>;
  },
): CardStaleness | undefined {
  const { ref } = card;
  const board = ref.boardId ? state.boards[ref.boardId] : undefined;
  switch (card.kind) {
    case "board":
      return ref.boardId && !state.boards[ref.boardId] && Object.keys(state.boards).length
        ? "gone"
        : undefined;
    case "frame":
    case "preview":
      return board && !board.frames.some((f) => f.id === ref.frameId) ? "gone" : undefined;
    case "screen":
      return undefined;
    case "node": {
      if (!ref.screenId || !state.screens[ref.screenId]) return undefined;
      const node = selectedNode(state.screens, { screenId: ref.screenId, path: ref.path ?? "" });
      if (!node) return "gone";
      return card.label.split(" › ").pop() === nodeName(node) ? undefined : "changed";
    }
    case "comment": {
      if (!ref.threadId || !(ref.threadId in state.threads)) return undefined;
      const thread = state.threads[ref.threadId];
      if (!thread) return "gone";
      const message = thread.messages.find((m) => m.id === ref.messageId);
      if (ref.messageId && (!message || message.deletedAt)) return "gone";
      return thread.status === "resolved" ? "resolved" : undefined;
    }
    case "note":
      return undefined;
  }
}
