import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import {
  addLookbookRequest,
  generateLookbook,
  lookbookState,
  readLookbook,
  removeLookbookImage,
  updateLookbook,
} from "../lookbook.ts";

// A 1x1 PNG, as the cloud would answer with one.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let t: TestContext;
let server: ReturnType<typeof Bun.serve>;
let requests: Record<string, unknown>[];
let refuse: ((body: Record<string, unknown>) => boolean) | null;

beforeEach(async () => {
  t = await testContext();
  requests = [];
  refuse = null;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      requests.push(body);
      if (refuse?.(body)) {
        return Response.json(
          { error: "generation_failed", message: "the model refused" },
          { status: 502 },
        );
      }
      return Response.json({
        id: `g${requests.length}`,
        intent: body.intent,
        model: body.model ?? "velloo-sketch",
        chargedMicros: 20_000,
        balanceMicros: 1_000_000 - 20_000 * requests.length,
        assets: [{ kind: "image", dataUrl: `data:image/png;base64,${PNG}` }],
      });
    },
  });
});

afterEach(() => server.stop(true));

const cloud = () => ({ url: `http://localhost:${server.port}`, token: "vlk_test" });

const BRIEF = {
  origin: "existing" as const,
  product: "Trailhead, a hiking trip planner",
  page: "the landing page",
  content: 'Hero: "Plan less, hike more."',
  notes: "",
};

const DIRECTIONS = [
  {
    id: "poster",
    title: "Park poster",
    description: "Screen-printed park posters",
    layout: "An illustrated hero",
  },
  { id: "instrument", title: "Field instrument", description: "Swiss grid, safety orange" },
  { id: "editorial", title: "Outdoors editorial", description: "Full-bleed photography" },
];

test("a folder with no lookbook reads as not started, and the first write starts it", async () => {
  expect((await lookbookState(t.root)).started).toBe(false);
  const r = await updateLookbook(t.ctx, { brief: BRIEF, directions: DIRECTIONS });
  expect(r.ok).toBe(true);
  const state = await lookbookState(t.root);
  expect(state.started).toBe(true);
  // The first directions move the stage on, so the canvas follows the agent.
  expect(state.lookbook.stage).toBe("directions");
  expect(state.lookbook.directions.map((d) => d.id)).toEqual(["poster", "instrument", "editorial"]);
  expect(t.events).toContainEqual({ type: "lookbook-changed" });
});

test("a new direction needs words to draw from; an existing one is patched by id", async () => {
  const missing = await updateLookbook(t.ctx, { directions: [{ id: "x" }] });
  expect(missing.ok).toBe(false);
  await updateLookbook(t.ctx, { directions: DIRECTIONS });
  await updateLookbook(t.ctx, { directions: [{ id: "poster", dropped: true }] });
  const { lookbook } = await readLookbook(t.root);
  expect(lookbook.directions.find((d) => d.id === "poster")?.dropped).toBe(true);
  expect(lookbook.directions.find((d) => d.id === "poster")?.title).toBe("Park poster");
});

test("images need a brief and a cloud", async () => {
  await updateLookbook(t.ctx, { directions: DIRECTIONS });
  const noBrief = await generateLookbook(t.ctx, cloud(), { kind: "moodboard" });
  expect(noBrief.ok).toBe(false);
  await updateLookbook(t.ctx, { brief: BRIEF });
  const noCloud = await generateLookbook(t.ctx, undefined, { kind: "moodboard" });
  expect(noCloud.ok).toBe(false);
  expect(requests).toHaveLength(0);
});

test("a mood board per direction still in the running, stored under assets/lookbook", async () => {
  await updateLookbook(t.ctx, { brief: BRIEF, directions: DIRECTIONS });
  await updateLookbook(t.ctx, { directions: [{ id: "editorial", dropped: true }] });
  const r = await generateLookbook(t.ctx, cloud(), { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made.map((m) => m.path)).toEqual([
    "assets/lookbook/poster/board-1.png",
    "assets/lookbook/instrument/board-1.png",
  ]);
  expect(r.value.cost).toContain("cost $0.04");
  expect(requests.every((b) => b.intent === "moodboard")).toBe(true);
  expect(String(requests[0]?.prompt)).toContain("mood board for Trailhead");
  expect((await stat(join(t.root, "assets/lookbook/poster/board-1.png"))).size).toBeGreaterThan(0);
  const { lookbook } = await readLookbook(t.root);
  expect(lookbook.stage).toBe("boards");
  expect(lookbook.directions[0]?.boards[0]?.model).toBe("velloo-sketch");
  // A regenerate draws the next board beside the first; the last is current.
  await generateLookbook(t.ctx, cloud(), { kind: "moodboard", directions: ["poster"] });
  const again = await readLookbook(t.root);
  expect(again.lookbook.directions[0]?.boards.map((b) => b.path)).toEqual([
    "assets/lookbook/poster/board-1.png",
    "assets/lookbook/poster/board-2.png",
  ]);
});

test("mocks are drawn from the current mood board, mockCount per picked direction, with the page's copy", async () => {
  await updateLookbook(t.ctx, { brief: BRIEF, directions: DIRECTIONS, mockCount: 2 });
  await generateLookbook(t.ctx, cloud(), { kind: "moodboard" });
  await updateLookbook(t.ctx, {
    directions: [
      { id: "instrument", picked: false },
      { id: "editorial", picked: false },
    ],
    models: { mock: "velloo-draft" },
  });
  requests = [];
  const r = await generateLookbook(t.ctx, cloud(), { kind: "mock" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made.map((m) => m.path)).toEqual([
    "assets/lookbook/poster/mock-1.png",
    "assets/lookbook/poster/mock-2.png",
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.model).toBe("velloo-draft");
  expect(String(requests[0]?.prompt)).toContain("attached mood board");
  expect(String(requests[0]?.prompt)).toContain("Plan less, hike more.");
  expect((requests[0]?.reference as string[])[0]).toStartWith("data:image/png;base64,");
  const { lookbook } = await readLookbook(t.root);
  expect(lookbook.stage).toBe("mocks");
  expect(lookbook.directions[0]?.mocks[0]?.fromBoard).toBe("assets/lookbook/poster/board-1.png");
});

test("with mood boards skipped, a mock is drawn from the direction's words", async () => {
  await updateLookbook(t.ctx, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateLookbook(t.ctx, cloud(), { kind: "mock", count: 1 });
  expect(requests[0]?.reference).toBeUndefined();
  expect(String(requests[0]?.prompt)).toContain("Art direction: Park poster");
});

test("one refused image is reported beside the ones that landed", async () => {
  await updateLookbook(t.ctx, { brief: BRIEF, directions: DIRECTIONS });
  refuse = (b) => String(b.prompt).includes("Outdoors editorial");
  const r = await generateLookbook(t.ctx, cloud(), { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made).toHaveLength(2);
  expect(r.value.failed).toEqual([
    { direction: "editorial", message: expect.stringContaining("refused") },
  ]);
});

test("choosing a mock checks it exists and moves the lookbook to the build", async () => {
  await updateLookbook(t.ctx, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  const wrong = await updateLookbook(t.ctx, {
    chosen: { direction: "poster", mock: "assets/nope.png" },
  });
  expect(wrong.ok).toBe(false);
  await generateLookbook(t.ctx, cloud(), { kind: "mock", count: 1 });
  const r = await updateLookbook(t.ctx, {
    chosen: { direction: "poster", mock: "assets/lookbook/poster/mock-1.png" },
  });
  expect(r.ok && r.value.stage).toBe("build");
  // Deleting the chosen mock clears the choice and the file.
  await removeLookbookImage(t.ctx, "assets/lookbook/poster/mock-1.png");
  const { lookbook } = await readLookbook(t.root);
  expect(lookbook.chosen).toBeNull();
  expect(
    await readFile(join(t.root, "assets/lookbook/poster/mock-1.png")).catch(() => null),
  ).toBeNull();
});

test("a request from the canvas waits until the agent clears it", async () => {
  await addLookbookRequest(t.ctx, { kind: "propose-directions", text: "Two more, one darker" });
  const { lookbook } = await readLookbook(t.root);
  expect(lookbook.requests).toHaveLength(1);
  await updateLookbook(t.ctx, { resolveRequests: [lookbook.requests[0]?.id as string] });
  expect((await readLookbook(t.root)).lookbook.requests).toHaveLength(0);
});
