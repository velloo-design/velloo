import { describe, expect, test } from "bun:test";
import type { AgentItem } from "@velloo/protocol/agent";
import type { Board, CommentThread, Screen } from "@velloo/schema";
import { renderToStaticMarkup } from "react-dom/server";
import {
  boardCards,
  cardStaleness,
  commentCard,
  selectionCard,
  viewCard,
} from "../agent-context.ts";
import { AgentText, parseAgentText } from "../components/Agent/agent-text.tsx";
import { canvasTargetOf, segmentsOf, workSummary } from "../components/Agent/conversation.tsx";

const tool = (
  input: string,
  extra: Partial<Extract<AgentItem, { kind: "tool" }>> = {},
): AgentItem => ({
  kind: "tool",
  id: crypto.randomUUID(),
  name: "call_velloo",
  server: "velloo",
  status: "completed",
  input,
  ...extra,
});
const command = (status: "completed" | "declined" = "completed"): AgentItem => ({
  kind: "command",
  id: crypto.randomUUID(),
  command: "bun test",
  status,
  output: "",
});

describe("reading what an agent writes", () => {
  test("fenced code, lists, headings and paragraphs are separate blocks", () => {
    const blocks = parseAgentText(
      "# Done\n\nIt works:\n- one\n- two\n\n```ts\nconst a = 1;\n```\n1. first",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["h", "p", "ul", "code", "ol"]);
    expect(blocks[3]).toEqual({ kind: "code", lang: "ts", text: "const a = 1;" });
  });

  test("inline code, bold and safe links render; unsafe links stay text", () => {
    const html = renderToStaticMarkup(
      <AgentText
        text={
          "Use `bun test` and **ship** — see [docs](https://velloo.ai) or [x](javascript:alert(1))"
        }
      />,
    );
    expect(html).toContain("<code");
    expect(html).toContain("<strong>ship</strong>");
    expect(html).toContain('href="https://velloo.ai"');
    expect(html).not.toContain("javascript:");
  });
});

describe("summarising a run of work", () => {
  test("counts commands, files and design edits apart from design reads", () => {
    const items: AgentItem[] = [
      command(),
      command("declined"),
      {
        kind: "file-change",
        id: "f",
        status: "completed",
        changes: [
          { path: "a.ts", change: "update" },
          { path: "b.ts", change: "add" },
        ],
      },
      tool('{"operation": "compose", "arguments": {"screenId": "home"}}'),
      tool('{"operation": "get_screen", "arguments": {"screenId": "home"}}'),
    ];
    expect(workSummary(items)).toBe("Ran 1 command · edited 2 files · 1 design edit · 1 declined");
    expect(workSummary([tool('{"operation": "list_boards"}')])).toBe("Looked at the design");
    // The guided surface splits reads from changes by the tool itself.
    expect(workSummary([tool('{"operation": "get_screen"}', { name: "read_velloo" })])).toBe(
      "Looked at the design",
    );
    expect(workSummary([tool('{"operation": "add_note"}', { name: "call_velloo" })])).toBe(
      "1 design edit",
    );
    expect(workSummary([tool("{}", { name: "update_props" })])).toBe("1 design edit");
    expect(workSummary([tool("{}", { name: "get_board" })])).toBe("Looked at the design");
  });

  test("a Velloo call names the screen it touched, even with its arguments cut short", () => {
    expect(
      canvasTargetOf(
        tool(
          '{\n  "operation": "update_props",\n  "arguments": {\n    "screenId": "pricing", "patc…',
        ),
      ),
    ).toEqual({
      screenId: "pricing",
    });
    expect(canvasTargetOf(tool("{}", { server: "github" }))).toBeNull();
  });

  test("a turn reads as text, then work folded together, then text again", () => {
    const items: AgentItem[] = [
      { kind: "user", id: "u", text: "go" },
      { kind: "agent-text", id: "a", text: "On it." },
      command(),
      { kind: "reasoning", id: "r", text: "hmm" },
      command(),
      { kind: "notice", id: "n", level: "warning", text: "slow" },
      { kind: "agent-text", id: "b", text: "Done." },
      { kind: "agent-text", id: "c", text: "  " },
    ];
    expect(
      segmentsOf(items).map((s) => (s.kind === "work" ? `work×${s.items.length}` : s.kind)),
    ).toEqual(["text", "work×3", "notice", "text"]);
  });
});

describe("canvas context as cards", () => {
  const screen = {
    id: "hero",
    name: "Hero",
    tree: { $ref: "Card", children: [{ $ref: "Button", $id: "cta" }] },
  } as unknown as Screen;
  const board = {
    id: "pricing",
    name: "Pricing",
    frames: [{ id: "f1", screen: "hero", x: 0, y: 0, w: 1440, h: 900 }],
  } as unknown as Board;

  const labelled = {
    ...board,
    frames: [
      { id: "f1", screen: "hero", x: 0, y: 0, w: 1440, h: 900, label: "1 · Hero, desktop" },
      { id: "f2", screen: "hero", x: 0, y: 0, w: 390, h: 844 },
    ],
  } as unknown as Board;

  test("the selection is the card to add, named by its frame as the canvas shows it", () => {
    const where = { board: labelled, screens: { hero: screen } };
    const node = selectionCard({ ...where, selection: { screenId: "hero", path: "0" } });
    expect(node).toEqual({
      kind: "node",
      ref: { boardId: "pricing", screenId: "hero", path: "0", frameId: "f1" },
      label: "1 · Hero, desktop › cta",
    });
    // Selecting a screen's root means the whole frame.
    expect(selectionCard({ ...where, selection: { screenId: "hero", path: "" } })).toEqual({
      kind: "frame",
      ref: { boardId: "pricing", frameId: "f1", screenId: "hero" },
      label: "1 · Hero, desktop",
    });
    expect(selectionCard({ ...where, selection: null })).toBeNull();
    expect(selectionCard({ ...where, selection: { screenId: "hero", path: "9" } })).toBeNull();
    expect(selectionCard({ ...where, selection: { screenId: "gone", path: "0" } })).toBeNull();
  });

  test("where the person is: the open board only, never the frame in view", () => {
    expect(viewCard({ board: labelled })).toEqual({
      kind: "view",
      ref: { boardId: "pricing" },
      label: "Pricing",
    });
    expect(viewCard({ board: undefined })).toBeNull();
  });

  test("the attach menu offers every frame by its name, then the notes", () => {
    const cards = boardCards({
      board: labelled,
      screens: { hero: screen },
      selection: null,
      notes: [
        { id: "n1", width: 200, body: "## Pricing should feel **calmer** than the home page" },
        { id: "n2", width: 200, body: "   " },
      ],
    });
    expect(cards.map((c) => `${c.kind}:${c.label}`)).toEqual([
      "frame:1 · Hero, desktop",
      "frame:Hero",
      "note:Note “Pricing should feel calmer than…”",
    ]);
    expect(boardCards({ board: undefined, screens: {}, selection: null })).toEqual([]);
  });

  test("a card whose node moved or went is stale; one the canvas can't judge is left alone", () => {
    const node = selectionCard({
      board,
      screens: { hero: screen },
      selection: { screenId: "hero", path: "0" },
    });
    if (!node) throw new Error("no node card");
    const state = { boards: { pricing: board }, screens: { hero: screen }, threads: {} };
    expect(cardStaleness(node, state)).toBeUndefined();
    const renamed = {
      ...screen,
      tree: { $ref: "Card", children: [{ $ref: "Button", $id: "buy" }] },
    } as unknown as Screen;
    expect(cardStaleness(node, { ...state, screens: { hero: renamed } })).toBe("changed");
    const emptied = { ...screen, tree: { $ref: "Card", children: [] } } as unknown as Screen;
    expect(cardStaleness(node, { ...state, screens: { hero: emptied } })).toBe("gone");
    expect(cardStaleness(node, { ...state, screens: {} })).toBeUndefined();
  });

  test("a comment becomes a card with its author, words and target; resolving or deleting it makes it stale", () => {
    const thread = {
      id: "t1",
      scope: "shared",
      folderId: "f",
      boardId: "pricing",
      anchor: {
        kind: "node",
        boardId: "pricing",
        frameId: "f1",
        screenId: "hero",
        locator: [0],
        bounds: { x: 0, y: 0, w: 1, h: 1 },
      },
      origin: { kind: "local" },
      status: "open",
      messages: [
        {
          id: "m1",
          author: { kind: "reviewer", displayName: "Maya" },
          body: "Make it\nbigger",
          createdAt: "2026-10-14T00:00:00Z",
        },
      ],
      createdAt: "2026-10-14T00:00:00Z",
      updatedAt: "2026-10-14T00:00:00Z",
    } as unknown as CommentThread;
    const card = commentCard(thread, board, { hero: screen });
    expect(card).toEqual({
      kind: "comment",
      ref: { boardId: "pricing", threadId: "t1", messageId: "m1", screenId: "hero" },
      label: "Pricing › Hero › cta",
      detail: "Make it bigger",
      author: "Maya",
    });
    const state = {
      boards: {},
      screens: {},
      threads: { t1: thread } as Record<string, CommentThread | null>,
    };
    expect(cardStaleness(card, state)).toBeUndefined();
    expect(
      cardStaleness(card, { ...state, threads: { t1: { ...thread, status: "resolved" } } }),
    ).toBe("resolved");
    expect(cardStaleness(card, { ...state, threads: { t1: null } })).toBe("gone");
  });
});
