import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentContextCard } from "@velloo/protocol/agent";
import type { CommentThread } from "@velloo/schema";
import { expandPrompt } from "../agent/context.ts";
import {
  designBoard,
  designScreen,
  type TestContext,
  testContext,
} from "../testing/design-folder.ts";

let t: TestContext;

const thread: CommentThread = {
  id: "11111111-1111-4111-8111-111111111111",
  scope: "shared",
  folderId: "f",
  boardId: "pricing",
  origin: { kind: "published", slug: "s", versionId: "v" },
  status: "open",
  messages: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      author: { kind: "reviewer", displayName: "Maya" },
      body: "The CTA sits too close\nto the subhead.",
      createdAt: "2026-10-14T00:00:00.000Z",
    },
  ],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};
const threads = async (id: string) => (id === thread.id ? thread : null);
const expand = (text: string, context: AgentContextCard[]) =>
  expandPrompt({ text, context }, t.folder, threads);

beforeAll(async () => {
  t = await testContext({
    screens: {
      hero: designScreen("hero", {
        tree: {
          $ref: "Card",
          children: [{ $ref: "Button", $id: "cta", props: { children: "Start" } }],
        },
      } as never),
    },
    boards: { pricing: designBoard("pricing", ["hero"], { name: "Pricing" }) },
  });
});
afterAll(() => t.cleanup());

describe("expanding canvas context into the prompt", () => {
  test("text alone passes through untouched", async () => {
    expect(await expand("Make it taller", [])).toBe("Make it taller");
  });

  test("each card names its target in the design's own ids", async () => {
    const text = await expand("Tighten this", [
      { kind: "board", ref: { boardId: "pricing" }, label: "Pricing" },
      { kind: "frame", ref: { boardId: "pricing", frameId: "frame-hero" }, label: "Hero" },
      { kind: "node", ref: { screenId: "hero", path: "0" }, label: "Button" },
      { kind: "preview", ref: { boardId: "pricing", frameId: "frame-hero" }, label: "Preview" },
    ]);
    expect(text.split("\n")[0]).toBe("Tighten this");
    expect(text).toContain('The board "Pricing" (pricing).');
    expect(text).toContain(
      'Frame frame-hero on the board "Pricing" (pricing), showing screen "Hero" (hero) at 1440×900 — take a velloo `screenshot` of it to see it.',
    );
    expect(text).toContain('the node at path [0]: Button $id "cta"');
    expect(text).toContain("velloo `screenshot`");
  });

  test("where the person is comes along, so 'this board' means something", async () => {
    const text = await expand("Describe this board", [
      {
        kind: "view",
        ref: { boardId: "pricing", screenId: "hero", path: "0" },
        label: "Pricing › Hero › cta",
      },
    ]);
    expect(text).toContain(
      'The person has the board "Pricing" (pricing) open in the canvas, looking at the screen "Hero" (hero), with the node at path [0] selected: Button $id "cta".',
    );
    const board = await expand("", [
      { kind: "view", ref: { boardId: "pricing" }, label: "Pricing" },
    ]);
    expect(board).not.toContain("Address these comments");
    expect(board).toContain(
      'The person has the board "Pricing" (pricing) open in the canvas; "this board" means it. A screen you make for them goes on it — compose with `boardId: "pricing"` — or they won\'t see it.',
    );
  });

  test("the design-language stage is where the person is, with the theme it is on", async () => {
    const text = await expand("Warmer greys", [
      { kind: "language", ref: { theme: "Night" }, label: "Design language · Night" },
    ]);
    expect(text).toContain(
      'The person has the design language open in the canvas instead of a board, on the theme "Night"',
    );
    expect(text).toContain('`set_theme` with `theme: "Night"`');
    expect(text).toContain("`set_design_language`");
    const plain = await expand("Warmer greys", [
      { kind: "language", ref: { theme: "default" }, label: "Design language" },
    ]);
    expect(plain).toContain("on the default theme");
    expect(plain).not.toContain("`theme:");
  });

  test("a frame with a label is named by it, the way the canvas shows it", async () => {
    const board = t.folder.boards.get("pricing");
    if (!board) throw new Error("no board");
    const labelled = {
      ...t.folder,
      boards: new Map([
        [
          "pricing",
          { ...board, frames: board.frames.map((f) => ({ ...f, label: "1 - Stage opens" })) },
        ],
      ]),
    } as typeof t.folder;
    const frameId = board.frames[0]?.id ?? "";
    const text = await expandPrompt(
      {
        text: "This one",
        context: [
          { kind: "view", ref: { boardId: "pricing", frameId, screenId: "hero" }, label: "x" },
          { kind: "frame", ref: { boardId: "pricing", frameId }, label: "1 - Stage opens" },
        ],
      },
      labelled,
      threads,
    );
    expect(text).toContain(`looking at the frame "1 - Stage opens" (${frameId}), which shows`);
    expect(text).toContain(`Frame "1 - Stage opens" (${frameId}) on the board`);
  });

  test("a screen, a note and a snippet instance are named as what they are", async () => {
    await t.write("boards/pricing.notes.json", [
      { id: "n1", x: 0, y: 0, width: 200, body: "Calmer than **home**" },
    ]);
    const folder = await t.reload();
    const text = await expandPrompt(
      {
        text: "Look",
        context: [
          { kind: "screen", ref: { screenId: "hero" }, label: "Hero" },
          { kind: "screen", ref: { screenId: "gone" }, label: "Gone" },
          { kind: "note", ref: { boardId: "pricing", noteId: "n1" }, label: "Note" },
          { kind: "note", ref: { boardId: "pricing", noteId: "n9" }, label: "Old note" },
        ],
      },
      folder,
      threads,
    );
    expect(text).toContain('The screen "Hero" (hero).');
    expect(text).toContain("Screen gone — no longer in the design");
    expect(text).toContain('A note on the board "Pricing" (pricing): "Calmer than **home**"');
    expect(text).toContain("Note n9 — no longer in the design");
  });

  test("a target that no longer exists says so instead of pointing at something else", async () => {
    const text = await expand("Fix", [
      { kind: "node", ref: { screenId: "hero", path: "0.4" }, label: "Old badge" },
      { kind: "frame", ref: { boardId: "pricing", frameId: "gone" }, label: "Gone" },
    ]);
    expect(text).toContain('no longer in the design (the person attached it as "Old badge")');
    expect(text).toContain("Frame gone — no longer in the design");
  });

  test("comments alone become a request to address them, with the thread to reply on", async () => {
    const text = await expand("", [
      {
        kind: "comment",
        ref: { boardId: "pricing", threadId: thread.id, messageId: thread.messages[0]?.id ?? "" },
        label: "Pricing › Hero › CTA",
        detail: "The CTA sits too close",
        author: "Maya",
      },
    ]);
    expect(text.startsWith("Address these comments on the design.")).toBe(true);
    expect(text).toContain(`Comment thread ${thread.id} (cloud) on Pricing › Hero › CTA`);
    expect(text).toContain('Maya wrote: "The CTA sits too close to the subhead."');
    expect(text).toContain("leave resolving it to the person");
  });

  test("the rest of the thread comes along, so a reply is read in context", async () => {
    const reply = {
      id: "33333333-3333-4333-8333-333333333333",
      author: { kind: "user" as const, displayName: "Ana" },
      body: "Agreed, and the subhead too.",
      createdAt: "2026-10-14T01:00:00.000Z",
    };
    const threaded = { ...thread, messages: [...thread.messages, reply] };
    const text = await expandPrompt(
      {
        text: "",
        context: [
          {
            kind: "comment",
            ref: { boardId: "pricing", threadId: thread.id, messageId: reply.id },
            label: "CTA",
          },
        ],
      },
      t.folder,
      async () => threaded,
    );
    expect(text).toContain('Ana wrote: "Agreed, and the subhead too."');
    expect(text).toContain('Also in the thread — Maya: "The CTA sits too close to the subhead."');
  });

  test("a resolved or deleted comment is marked, not silently dropped", async () => {
    const text = await expand("", [
      { kind: "comment", ref: { boardId: "pricing", threadId: "missing" }, label: "Gone" },
    ]);
    expect(text).toContain("Comment thread missing — no longer in the design");
  });
});
