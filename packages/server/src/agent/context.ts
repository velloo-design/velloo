import type { AgentContextCard, AgentPromptBody } from "@velloo/protocol/agent";
import type { CommentThread, Node } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { getNode } from "../mutations/lookup.ts";

/** Replies quoted beside the attached message, newest first to go. */
const MAX_THREAD_MESSAGES = 6;

/** What context expansion reads besides the folder: a comment thread, by id. */
export type ThreadLookup = (threadId: string) => Promise<CommentThread | null>;

const quote = (text: string, max = 600) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return `"${flat.length > max ? `${flat.slice(0, max)}…` : flat}"`;
};

function nodeLabel(node: Node): string {
  const record = node as Record<string, unknown>;
  const kind =
    typeof record.$ref === "string"
      ? record.$ref
      : typeof record.$snippet === "string"
        ? `snippet ${record.$snippet}`
        : typeof record.$text === "string"
          ? "text"
          : "node";
  const id = typeof record.$id === "string" ? ` $id "${record.$id}"` : "";
  const text = typeof record.$text === "string" ? ` ${quote(record.$text, 80)}` : "";
  return `${kind}${id}${text}`;
}

function pathOf(path: string | undefined): number[] | null {
  if (path === undefined || path === "") return [];
  const parts = path.split(".").map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : null;
}

/**
 * One card, as a line the agent can act on: what it names, in the design's
 * own ids so the agent can pass them straight to the velloo tools, and — when
 * the target has changed or gone since the card was made — that it has, so
 * the agent never edits a node that is no longer the one the person meant.
 */
async function describe(
  card: AgentContextCard,
  folder: DesignFolder,
  thread: ThreadLookup,
): Promise<string> {
  const { ref } = card;
  const board = ref.boardId ? folder.boards.get(ref.boardId) : undefined;
  const boardName = board ? `board "${board.name}" (${board.id})` : `board ${ref.boardId ?? "?"}`;
  const screen = ref.screenId ? folder.screens.get(ref.screenId) : undefined;
  const screenName = screen
    ? `screen "${screen.name}" (${screen.id})`
    : `screen ${ref.screenId ?? "?"}`;
  const gone = (what: string) =>
    `${what} — no longer in the design (the person attached it as "${card.label}")`;

  switch (card.kind) {
    case "view": {
      if (!board) return gone(`Board ${ref.boardId}`);
      const parts = [`The person has the ${boardName} open in the canvas`];
      // A canvas from before the view became the board alone still sends the
      // frame in view and the selection.
      const inView = board.frames.find((f) => f.id === ref.frameId);
      if (screen) {
        parts.push(
          inView?.label
            ? `looking at the frame "${inView.label}" (${inView.id}), which shows the ${screenName}`
            : `looking at the ${screenName}`,
        );
      }
      const path = pathOf(ref.path);
      if (screen && path && ref.path) {
        const node = getNode(screen.tree, path, screen.id);
        if (node.ok)
          parts.push(
            `with the node at path [${path.join(", ")}] selected: ${nodeLabel(node.value)}`,
          );
      }
      if (screen) return `${parts.join(", ")}. "This board", "this screen" and "this" mean these.`;
      return `${parts[0]}; "this board" means it. A screen you make for them goes on it — compose with \`boardId: "${board.id}"\` — or they won't see it.`;
    }
    case "language": {
      const theme = ref.theme ?? "default";
      const named = theme === "default" ? "the default theme" : `the theme "${theme}"`;
      const pass = theme === "default" ? "" : ` with \`theme: "${theme}"\``;
      return `The person has the design language open in the canvas instead of a board, on ${named}: its colours, type and shape beside a live specimen, and the design's rules in words. "This", "the theme" and "the language" mean these. Read them with \`get_theme\`${pass}, change the tokens with \`set_theme\`${pass} and the rules with \`set_design_language\`; the specimen redraws as you go. The person keeps or undoes the visit's changes with the stage's Done and Cancel.`;
    }
    case "board":
      return board ? `The ${boardName}.` : gone(`Board ${ref.boardId}`);
    case "screen":
      return screen ? `The ${screenName}.` : gone(`Screen ${ref.screenId}`);
    case "frame": {
      const frame = board?.frames.find((f) => f.id === ref.frameId);
      if (!frame) return gone(`Frame ${ref.frameId}`);
      const shown = folder.screens.get(frame.screen);
      const named = frame.label ? `Frame "${frame.label}" (${frame.id})` : `Frame ${frame.id}`;
      return `${named} on the ${boardName}, showing screen "${shown?.name ?? frame.screen}" (${frame.screen}) at ${frame.w}×${frame.h} — take a velloo \`screenshot\` of it to see it.`;
    }
    case "node": {
      const path = pathOf(ref.path);
      if (!screen || !path) return gone(`A node in ${screenName}`);
      const node = getNode(screen.tree, path, screen.id);
      if (!node.ok) return gone(`The node at path "${ref.path}" in ${screenName}`);
      return `In ${screenName}, the node at path [${path.join(", ")}]: ${nodeLabel(node.value)}.`;
    }
    case "preview": {
      const frame = board?.frames.find((f) => f.id === ref.frameId);
      const target = frame ? `frame ${frame.id} on the ${boardName}` : screenName;
      return `What ${target} looks like now — take a velloo \`screenshot\` of it to see it.`;
    }
    case "note": {
      const note = ref.boardId
        ? folder.notes.get(ref.boardId)?.find((n) => n.id === ref.noteId)
        : undefined;
      return note ? `A note on the ${boardName}: ${quote(note.body)}` : gone(`Note ${ref.noteId}`);
    }
    case "comment": {
      const found = ref.threadId ? await thread(ref.threadId) : null;
      if (!found) return gone(`Comment thread ${ref.threadId}`);
      const message =
        found.messages.find((m) => m.id === ref.messageId && !m.deletedAt) ??
        found.messages.find((m) => !m.deletedAt);
      const author = message?.author.displayName ?? card.author ?? "Someone";
      const where = card.detail ? ` on ${card.label}` : "";
      const state = found.status === "resolved" ? " It has since been resolved." : "";
      // The rest of the conversation, so the agent reads a reply in context.
      const others = found.messages
        .filter((m) => m.id !== message?.id && !m.deletedAt)
        .slice(-MAX_THREAD_MESSAGES)
        .map((m) => `${m.author.displayName ?? m.author.kind}: ${quote(m.body, 240)}`);
      return [
        `Comment thread ${found.id} (${found.scope === "shared" ? "cloud" : "local"})${where}, on the ${boardName}`,
        `${author} wrote: ${quote(message?.body ?? "")}.${state}`,
        ...(others.length ? [`Also in the thread — ${others.join("; ")}.`] : []),
        `When you've addressed it, reply on thread ${found.id} with what you changed (velloo \`update_comment_thread\`) — leave resolving it to the person.`,
      ].join(" ");
    }
  }
}

/**
 * The prompt the agent reads: the person's text, then each attached card
 * spelled out. Only what the person attached is expanded — never the whole
 * design, unrelated files, or anything else on the machine.
 */
export async function expandPrompt(
  body: AgentPromptBody,
  folder: DesignFolder,
  thread: ThreadLookup,
): Promise<string> {
  const cards = body.context ?? [];
  if (cards.length === 0) return body.text;
  const lines = await Promise.all(cards.map((card) => describe(card, folder, thread)));
  const onlyComments =
    cards.some((card) => card.kind === "comment") &&
    cards.every(
      (card) => card.kind === "comment" || card.kind === "view" || card.kind === "language",
    );
  const text = body.text.trim() || (onlyComments ? "Address these comments on the design." : "");
  return [
    text,
    "",
    "Canvas context the person attached (in the open Velloo design):",
    ...lines.map((line) => `- ${line}`),
  ]
    .join("\n")
    .trim();
}
