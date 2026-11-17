import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeSketchbookFailures, REVISION_NUDGES, SKETCHBOOK_LIMITS } from "@velloo/protocol";
import { imagesOf, type SketchbookDirection } from "@velloo/schema";
import { PNG as Png } from "pngjs";
import { expandPrompt } from "../../agent/context.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { screensStep } from "../next.ts";
import { kindPrompt, MAX_IMAGE_PROMPT, PROMPTED_KINDS, revisePrompt } from "../prompts.ts";
import { referenceCapture } from "../references.ts";
import {
  buildSketchbook,
  createSketchbook,
  deleteSketchbook,
  generateSketchbook,
  listSketchbooks,
  proposalTheme,
  readSketchbook,
  removeSketchbookImage,
  sketchbookState,
  updateSketchbook,
} from "../sketchbook.ts";

// A 1x1 PNG, as the cloud would answer with one.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// A 16x8 JPEG's first bytes up to its start-of-frame, which is all the size reader needs.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x08, 0x00,
  0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]).toString("base64");

let t: TestContext;
let server: ReturnType<typeof Bun.serve>;
let requests: Record<string, unknown>[];
let refuse: ((body: Record<string, unknown>) => boolean) | null;
let jpeg: boolean;
/** Whether the stub lists the sketchbook kinds, as a current cloud does. */
let listsKinds: boolean;
/** The sketchbook each test works on, begun fresh. */
let id: string;

async function read() {
  const r = await readSketchbook(t.root, id);
  if (!r) throw new Error(`no sketchbook ${id}`);
  return r;
}

beforeEach(async () => {
  t = await testContext();
  const made = await createSketchbook(t.ctx);
  if (!made.ok) throw new Error("could not begin a sketchbook");
  id = made.value.id;
  requests = [];
  refuse = null;
  jpeg = false;
  listsKinds = false;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "GET") {
        const url = new URL(req.url);
        if (!listsKinds || url.searchParams.get("group") !== "sketchbook") {
          return Response.json({ intents: [] });
        }
        return Response.json({ intents: KINDS });
      }
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
        assets: [
          {
            kind: "image",
            dataUrl: jpeg ? `data:image/jpeg;base64,${JPEG}` : `data:image/png;base64,${PNG}`,
          },
        ],
      });
    },
  });
});

afterEach(() => server.stop(true));

const kind = (intent: string, aspects: string[]) => ({
  intent,
  group: "sketchbook",
  label: intent,
  summary: intent,
  priceMicros: 20_000,
  output: "image",
  aspects,
  defaultAspect: aspects[0],
  reference: "optional",
  maxPromptChars: 6000,
  maxReferences: 3,
  tier: "starter",
  locked: false,
});
const KINDS = [
  kind("moodboard", ["3:2"]),
  kind("mock", ["9:16"]),
  kind("palette", ["3:2"]),
  kind("typeposter", ["2:3"]),
  kind("uikit", ["3:2"]),
  kind("imagery", ["3:2", "1:1"]),
  kind("icons", ["1:1"]),
  kind("mobile", ["9:16"]),
  kind("detail", ["3:2"]),
];

/** A direction's images of one kind. */
const of = (d: SketchbookDirection | undefined, k: string) => (d ? imagesOf(d, k) : []);

/** A refusal's message, or "" when it went through. */
const refusal = (r: { ok: boolean; error?: unknown }) =>
  !r.ok && r.error && typeof r.error === "object" && "message" in r.error
    ? String(r.error.message)
    : "";

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

test("a new sketchbook starts at the brief, and the first directions move it on", async () => {
  expect((await read()).sketchbook.stage).toBe("brief");
  const r = await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  expect(r.ok).toBe(true);
  const state = await sketchbookState(t.root, id);
  if (!state) throw new Error("gone");
  // The first directions move the stage on, so the canvas follows the agent.
  expect(state.sketchbook.stage).toBe("directions");
  expect(state.sketchbook.directions.map((d) => d.id)).toEqual([
    "poster",
    "instrument",
    "editorial",
  ]);
  expect(t.events).toContainEqual({ type: "sketchbook-changed", id });
});

test("a new direction needs words to draw from; an existing one is patched by id", async () => {
  const missing = await updateSketchbook(t.ctx, id, { directions: [{ id: "x" }] });
  expect(missing.ok).toBe(false);
  await updateSketchbook(t.ctx, id, { directions: DIRECTIONS });
  await updateSketchbook(t.ctx, id, { directions: [{ id: "poster", dropped: true }] });
  const { sketchbook } = await read();
  expect(sketchbook.directions.find((d) => d.id === "poster")?.dropped).toBe(true);
  expect(sketchbook.directions.find((d) => d.id === "poster")?.title).toBe("Park poster");
});

test("images need a brief and a cloud", async () => {
  await updateSketchbook(t.ctx, id, { directions: DIRECTIONS });
  const noBrief = await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  expect(noBrief.ok).toBe(false);
  await updateSketchbook(t.ctx, id, { brief: BRIEF });
  const noCloud = await generateSketchbook(t.ctx, undefined, id, { kind: "moodboard" });
  expect(noCloud.ok).toBe(false);
  expect(requests).toHaveLength(0);
});

test("a mood board per direction still in the running, stored under assets/sketchbook", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  await updateSketchbook(t.ctx, id, { directions: [{ id: "editorial", dropped: true }] });
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  // Each lands when it is drawn, in no fixed order.
  expect(r.value.made.map((m) => m.path).sort()).toEqual([
    `assets/sketchbook/${id}/instrument/board-1.png`,
    `assets/sketchbook/${id}/poster/board-1.png`,
  ]);
  expect(r.value.cost).toContain("cost 40 credits");
  expect(requests.every((b) => b.intent === "moodboard")).toBe(true);
  expect(String(requests[0]?.prompt)).toContain("mood board for Trailhead");
  expect(
    (await stat(join(t.root, `assets/sketchbook/${id}/poster/board-1.png`))).size,
  ).toBeGreaterThan(0);
  const { sketchbook } = await read();
  expect(sketchbook.stage).toBe("boards");
  expect(of(sketchbook.directions[0], "moodboard")[0]?.model).toBe("velloo-sketch");
  // A regenerate draws the next board beside the first; the last is current.
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard", directions: ["poster"] });
  const again = await read();
  expect(of(again.sketchbook.directions[0], "moodboard").map((b) => b.path)).toEqual([
    `assets/sketchbook/${id}/poster/board-1.png`,
    `assets/sketchbook/${id}/poster/board-2.png`,
  ]);
});

test("mocks are drawn from the current mood board, mockCount per picked direction, with the page's copy", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS, mockCount: 2 });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  await updateSketchbook(t.ctx, id, {
    directions: [
      { id: "instrument", picked: false },
      { id: "editorial", picked: false },
    ],
    models: { mock: "velloo-study" },
  });
  requests = [];
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "mock" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made.map((m) => m.path).sort()).toEqual([
    `assets/sketchbook/${id}/poster/mock-1.png`,
    `assets/sketchbook/${id}/poster/mock-2.png`,
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.model).toBe("velloo-study");
  expect(String(requests[0]?.prompt)).toContain("attached mood board");
  expect(String(requests[0]?.prompt)).toContain("Plan less, hike more.");
  expect(String((requests[0]?.reference as string[] | undefined)?.[0])).toStartWith(
    "data:image/png;base64,",
  );
  const { sketchbook } = await read();
  expect(sketchbook.stage).toBe("mocks");
  expect(of(sketchbook.directions[0], "mock")[0]?.fromBoard).toBe(
    `assets/sketchbook/${id}/poster/board-1.png`,
  );
});

test("with mood boards skipped, a mock is drawn from the direction's words", async () => {
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  expect(requests[0]?.reference).toBeUndefined();
  expect(String(requests[0]?.prompt)).toContain("Sketchbook: Park poster");
});

test("one refused image is reported beside the ones that landed", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  refuse = (b) => String(b.prompt).includes("Outdoors editorial");
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made).toHaveLength(2);
  expect(r.value.failed).toEqual([
    { direction: "editorial", message: expect.stringContaining("refused") },
  ]);
});

test("choosing mocks checks each exists, and deleting one unchooses it", async () => {
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  const wrong = await updateSketchbook(t.ctx, id, {
    chosen: [{ direction: "poster", image: "assets/nope.png" }],
  });
  expect(wrong.ok).toBe(false);
  await generateSketchbook(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  const r = await updateSketchbook(t.ctx, id, {
    chosen: [{ direction: "poster", image: `assets/sketchbook/${id}/poster/mock-1.png` }],
  });
  expect(r.ok && r.value.chosen).toHaveLength(1);
  // Deleting the chosen mock clears the choice and the file.
  await removeSketchbookImage(t.ctx, id, `assets/sketchbook/${id}/poster/mock-1.png`);
  const { sketchbook } = await read();
  expect(sketchbook.chosen).toEqual([]);
  expect(
    await readFile(join(t.root, `assets/sketchbook/${id}/poster/mock-1.png`)).catch(() => null),
  ).toBeNull();
});

test("deleting a sketchbook takes its images and leaves the others", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  const other = await createSketchbook(t.ctx, { origin: "new" });
  if (!other.ok) throw new Error("could not begin another");
  await deleteSketchbook(t.ctx, id);
  expect(await sketchbookState(t.root, id)).toBeNull();
  expect(await stat(join(t.root, `assets/sketchbook/${id}`)).catch(() => null)).toBeNull();
  expect((await listSketchbooks(t.root)).map((a) => a.id)).toEqual([other.value.id]);
});

test("a cloud that sends JPEG gets .jpg files, sized from the JPEG", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  jpeg = true;
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made[0]?.path).toBe(`assets/sketchbook/${id}/poster/board-1.jpg`);
  const { sketchbook } = await read();
  expect(of(sketchbook.directions[0], "moodboard")[0]).toMatchObject({ width: 16, height: 8 });
  // The next draw counts the .jpg as taken.
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  expect(of((await read()).sketchbook.directions[0], "moodboard")[1]?.path).toBe(
    `assets/sketchbook/${id}/poster/board-2.jpg`,
  );
});

test("mocks wait for a direction's mood board unless mood boards are skipped", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  // The board for one direction failed to draw: no mock is drawn from words in its place.
  refuse = (b) => String(b.prompt).includes("Field instrument");
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  requests = [];
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  expect(r.ok).toBe(false);
  if (!r.ok && r.error.kind === "BadRequest")
    expect(r.error.message).toContain('"Field instrument" has no mood board yet');
  expect(requests).toHaveLength(0);
});

test("the longest brief and direction the limits allow still fit one image prompt", async () => {
  const fill = (n: number) => "w ".repeat(n / 2);
  const brief = {
    origin: "existing" as const,
    product: fill(SKETCHBOOK_LIMITS.product),
    page: fill(SKETCHBOOK_LIMITS.page),
    content: fill(SKETCHBOOK_LIMITS.content),
    notes: fill(SKETCHBOOK_LIMITS.notes),
  };
  const direction = {
    id: "long",
    title: "x".repeat(80),
    description: fill(SKETCHBOOK_LIMITS.description),
    layout: fill(SKETCHBOOK_LIMITS.layout),
    dropped: false,
    picked: true,
    images: [],
    proposal: null,
    references: [],
    remixOf: [],
    take: "",
  };
  // As many references as a prompt is sent with, each noted as long as a note can be.
  const references = [1, 2, 3].map(() => ({
    note: fill(SKETCHBOOK_LIMITS.note),
    url: `https://${"x".repeat(200)}.example.com/`,
  }));
  const remix = {
    titles: ["x".repeat(80), "y".repeat(80)],
    take: fill(SKETCHBOOK_LIMITS.take),
    boards: 2,
  };
  for (const kind of PROMPTED_KINDS) {
    for (const fromBoard of [true, false]) {
      // Three images at most: the mood board, then a remix's boards, then
      // references. A page drawn from words alone drops references that don't fit.
      const withRemix = kind === "moodboard";
      const prompt = kindPrompt(kind, brief, direction, {
        fromBoard,
        focus: fill(SKETCHBOOK_LIMITS.focus),
        references: withRemix ? references.slice(0, 1) : fromBoard ? references.slice(0, 2) : [],
        ...(withRemix ? { remix } : {}),
      });
      expect(prompt?.length ?? Infinity).toBeLessThanOrEqual(MAX_IMAGE_PROMPT);
    }
  }
  for (const kind of PROMPTED_KINDS) {
    expect(
      revisePrompt(brief, fill(SKETCHBOOK_LIMITS.instruction), kind).length,
    ).toBeLessThanOrEqual(MAX_IMAGE_PROMPT);
  }
});

test("the same failure for every image is said once; different ones by direction", () => {
  const same = describeSketchbookFailures([
    { direction: "a", message: "No image provider." },
    { direction: "b", message: "No image provider." },
  ]);
  expect(same).toBe("No image provider.");
  const mixed = describeSketchbookFailures(
    [
      { direction: "a", message: "Refused." },
      { direction: "b", message: "Timed out." },
    ],
    (id) => id.toUpperCase(),
  );
  expect(mixed).toBe("A: Refused.\nB: Timed out.");
});

test("the sketchbook card tells the agent where the person is and what they picked", async () => {
  await updateSketchbook(t.ctx, id, {
    origin: "existing",
    page: { label: "/pricing", file: "app/pricing/page.tsx" },
  });
  const text = await expandPrompt(
    {
      text: "Start a Velloo sketchbook for this app.",
      context: [
        {
          kind: "sketchbook",
          ref: { step: "brief", sketchbook: id },
          label: "Sketchbook · Brief",
        },
      ],
    },
    t.ctx.folder,
    async () => null,
  );
  expect(text.startsWith("Start a Velloo sketchbook for this app.")).toBe(true);
  expect(text).toContain("on its brief step");
  expect(text).toContain(`get_sketchbook { id: "${id}" }`);
  expect(text).toContain("The person picked the page to redesign: /pricing");
});

test("a design keeps several sketchbooks, the one changed last first", async () => {
  const second = await createSketchbook(t.ctx, { origin: "new", name: "Night mode" });
  if (!second.ok) throw new Error("could not begin another");
  // The order is by the time of the last write, to the millisecond.
  await Bun.sleep(5);
  await updateSketchbook(t.ctx, id, { brief: BRIEF });
  const list = await listSketchbooks(t.root);
  expect(list.map((a) => a.id)).toEqual([id, second.value.id]);
  expect(list[0]?.name).toBe("the landing page");
  expect(list[1]?.name).toBe("Night mode");
});

test("building makes the board the screens go on, once, and keeps what the person added", async () => {
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "mock", count: 2 });
  const chosen = [1, 2].map((n) => ({
    direction: "poster",
    image: `assets/sketchbook/${id}/poster/mock-${n}.png`,
  }));
  const built = await buildSketchbook(t.ctx, id, {
    chosen,
    generateImages: false,
    withBoards: false,
    instructions: "Keep the navigation",
  });
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  expect(t.ctx.folder.boards.get(built.value.boardId)?.name).toBe("Sketchbook · the landing page");
  const { sketchbook } = await read();
  expect(sketchbook.stage).toBe("screens");
  expect(sketchbook.chosen).toEqual(chosen);
  expect(sketchbook.buildWithBoards).toBe(false);
  expect(sketchbook.buildBoard).toBe(built.value.boardId);
  expect(sketchbook.buildNotes).toBe("Keep the navigation");
  const again = await buildSketchbook(t.ctx, id, {
    chosen,
    generateImages: false,
    withBoards: true,
    instructions: "",
  });
  expect(again.ok && again.value.boardId).toBe(built.value.boardId);
});

test("images are recorded as each lands, not when the last one does", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  const before = t.events.filter((e) => e.type === "sketchbook-changed").length;
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  // Two pending marks, two images recorded, two pending cleared.
  const after = t.events.filter((e) => e.type === "sketchbook-changed").length;
  expect(after - before).toBeGreaterThanOrEqual(6);
});

test("deleting a sketchbook leaves no image and no empty folder behind", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  // An image no sketchbook records (its record was lost, its file deleted by hand).
  await mkdir(join(t.root, "assets/sketchbook/gone/poster"), { recursive: true });
  await writeFile(join(t.root, "assets/sketchbook/gone/poster/board-1.png"), "x");
  await deleteSketchbook(t.ctx, id);
  expect(await readdir(join(t.root, "assets")).catch(() => [])).not.toContain("sketchbook");
});

test("removing a direction deletes its images; dropping one keeps them", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  await updateSketchbook(t.ctx, id, { directions: [{ id: "instrument", dropped: true }] });
  const dir = (d: string) => join(t.root, `assets/sketchbook/${id}/${d}`);
  expect(await readdir(dir("instrument"))).toHaveLength(1);
  await updateSketchbook(t.ctx, id, { removeDirections: ["poster"] });
  expect(await stat(dir("poster")).catch(() => null)).toBeNull();
  expect(await readdir(dir("instrument"))).toHaveLength(1);
});

test("a revision redraws one mock with the change, from the mock itself", async () => {
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 2),
    skipBoards: true,
  });
  await generateSketchbook(t.ctx, cloud(), id, {
    kind: "mock",
    directions: ["poster"],
    count: 1,
  });
  const mock = `assets/sketchbook/${id}/poster/mock-1.png`;
  requests = [];
  const r = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "mock",
    count: 2,
    revise: { image: mock, instruction: "More spacious" },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made).toHaveLength(2);
  expect(requests).toHaveLength(2);
  expect(String(requests[0]?.prompt)).toContain("Change: More spacious.");
  expect(requests[0]?.reference).toHaveLength(1);
  const { sketchbook } = await read();
  const poster = sketchbook.directions.find((d) => d.id === "poster");
  expect(
    of(poster, "mock")
      .slice(1)
      .map((m) => [m.revisedFrom, m.instruction]),
  ).toEqual([
    [mock, "More spacious"],
    [mock, "More spacious"],
  ]);
  // Only the revised mock's direction is redrawn.
  expect(
    of(
      sketchbook.directions.find((d) => d.id === "instrument"),
      "mock",
    ),
  ).toEqual([]);
  const wrong = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "moodboard",
    revise: { image: mock, instruction: "x" },
  });
  expect(wrong.ok).toBe(false);
});

test("screens are designed from a mood board too, and a mock goes with its board", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  await generateSketchbook(t.ctx, cloud(), id, {
    kind: "mock",
    directions: ["poster"],
    count: 1,
  });
  const board = `assets/sketchbook/${id}/instrument/board-1.png`;
  const mock = `assets/sketchbook/${id}/poster/mock-1.png`;
  const built = await buildSketchbook(t.ctx, id, {
    chosen: [
      { direction: "instrument", image: board },
      { direction: "poster", image: mock },
    ],
    generateImages: true,
    withBoards: true,
    instructions: "",
  });
  expect(built.ok).toBe(true);
  const step = screensStep((await read()).sketchbook);
  expect(step).toContain(`the mood board ${board}`);
  expect(step).toContain(
    `the mock ${mock} (with its mood board assets/sketchbook/${id}/poster/board-1.png)`,
  );
  expect(step).toContain("inspiration, not a spec");
});

test("a current cloud's kinds draw from the mood board, one each, at the kind's aspect", async () => {
  listsKinds = true;
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  requests = [];
  const r = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "palette",
    directions: ["poster"],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made).toEqual([
    { direction: "poster", kind: "palette", path: `assets/sketchbook/${id}/poster/palette-1.png` },
  ]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.intent).toBe("palette");
  expect(String(requests[0]?.prompt)).toContain("attached mood board");
  expect(String(requests[0]?.prompt)).toContain("hex");
  expect(requests[0]?.reference).toHaveLength(1);
  const { sketchbook } = await read();
  // Another kind is drawn beside the mood board, and doesn't move the stage on.
  expect(sketchbook.stage).toBe("boards");
  expect(of(sketchbook.directions[0], "palette")[0]?.fromBoard).toBe(
    `assets/sketchbook/${id}/poster/board-1.png`,
  );

  const close = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "detail",
    directions: ["poster"],
    focus: "the pricing table",
    aspect: "3:2",
  });
  expect(close.ok).toBe(true);
  expect(String(requests.at(-1)?.prompt)).toContain("close-up of the pricing table");
  expect(requests.at(-1)?.aspect).toBe("3:2");
  const badAspect = await generateSketchbook(t.ctx, cloud(), id, { kind: "icons", aspect: "16:9" });
  expect(refusal(badAspect)).toContain('"1:1"');
  const badFocus = await generateSketchbook(t.ctx, cloud(), id, { kind: "uikit", focus: "x" });
  expect(badFocus.ok).toBe(false);
  const unknown = await generateSketchbook(t.ctx, cloud(), id, { kind: "poster" });
  expect(refusal(unknown)).toContain('"typeposter"');

  // Only a page image is chosen for a screen; the rest go with the screens.
  const palette = `assets/sketchbook/${id}/poster/palette-1.png`;
  const detail = `assets/sketchbook/${id}/poster/detail-1.png`;
  const refused = await updateSketchbook(t.ctx, id, {
    chosen: [{ direction: "poster", image: palette }],
  });
  expect(refused.ok).toBe(false);
  const chosen = await updateSketchbook(t.ctx, id, {
    chosen: [{ direction: "poster", image: detail }],
  });
  expect(chosen.ok).toBe(true);
  const step = screensStep((await read()).sketchbook);
  expect(step).toContain(`the detail close-up ${detail}`);
  expect(step).toContain(`its palette in context ${palette}`);

  const state = await sketchbookState(t.root, id);
  expect(Object.keys(state?.promptChars ?? {})).toEqual(
    expect.arrayContaining(["mobile", "icons"]),
  );
});

test("a cloud from before kinds draws only mood boards and mocks", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  const r = await generateSketchbook(t.ctx, cloud(), id, { kind: "palette" });
  expect(r.ok).toBe(false);
  expect(refusal(r)).toContain('"moodboard", "mock"');
  expect(requests).toHaveLength(0);
});

test("a mobile mock is revised as a mobile mock, and a palette as a palette", async () => {
  listsKinds = true;
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "mobile" });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "palette" });
  const mobile = `assets/sketchbook/${id}/poster/mobile-1.png`;
  requests = [];
  const asMock = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "mock",
    revise: { image: mobile, instruction: "Bigger type" },
  });
  expect(refusal(asMock)).toContain('send kind: "mobile"');
  const r = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "mobile",
    count: 1,
    revise: { image: mobile, instruction: "Bigger type" },
  });
  expect(r.ok).toBe(true);
  expect(String(requests[0]?.prompt)).toContain("full-length mobile design");
  requests = [];
  const palette = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "palette",
    revise: { image: `assets/sketchbook/${id}/poster/palette-1.png`, instruction: "Warmer" },
  });
  expect(palette.ok).toBe(true);
  expect(String(requests[0]?.prompt)).toContain("Revise the attached colour study");
  expect(String(requests[0]?.prompt)).not.toContain("Plan less, hike more.");
});

// --- A Look sketchbook -------------------------------------------------------

const PROPOSAL = {
  tokens: {
    "colors.background": "#f5efe4",
    "colors.primary.DEFAULT": "#2f4a3a",
    "colors.primary.foreground": "#f5efe4",
    "radius.md": "4px",
  },
  fonts: [{ role: "display", family: "Fraunces", google: true as const }],
};

async function lookSketchbook() {
  const made = await createSketchbook(t.ctx, { subject: "look" });
  if (!made.ok) throw new Error("could not begin a look sketchbook");
  const look = made.value.id;
  const r = await updateSketchbook(t.ctx, look, {
    brief: {
      origin: "new",
      product: "Trailhead, a hiking trip planner",
      page: "",
      content: "",
      notes: "Warm, outdoorsy",
    },
    directions: [
      { id: "poster", title: "Park poster", description: "Ochre #c8932b, pine #2f4a3a." },
    ],
  });
  if (!r.ok) throw new Error(refusal(r));
  return look;
}

test("a Look sketchbook's brief needs no page; a page sketchbook's does", async () => {
  const look = await lookSketchbook();
  const read = await readSketchbook(t.root, look);
  expect(read?.sketchbook).toMatchObject({ subject: "look", origin: "new", stage: "directions" });
  const page = await updateSketchbook(t.ctx, id, { brief: { ...BRIEF, page: "" } });
  expect(refusal(page)).toContain('subject: "look"');
});

test("a proposal is checked as set_theme checks it, and moves a Look sketchbook to tokens", async () => {
  const look = await lookSketchbook();
  const bad = await updateSketchbook(t.ctx, look, {
    directions: [
      { id: "poster", proposal: { tokens: { "colors.primry.DEFAULT": "#000" }, fonts: [] } },
    ],
  });
  expect(refusal(bad)).toContain("colors.primary.DEFAULT");
  const good = await updateSketchbook(t.ctx, look, {
    directions: [{ id: "poster", proposal: PROPOSAL }],
  });
  if (!good.ok) throw new Error(refusal(good));
  expect(good.value.stage).toBe("tokens");
  expect(good.value.directions[0]?.proposal).toEqual(PROPOSAL);
  // Nothing reaches the design's theme until a Look is made from it.
  expect(JSON.stringify(t.ctx.folder.theme)).not.toContain("Fraunces");

  const theme = await proposalTheme(t.ctx, look, "poster");
  if (!theme.ok) throw new Error(theme.error);
  expect(theme.value.colors.background).toBe("#f5efe4");
  expect(theme.value.typography.googleFonts?.some((g) => g.startsWith("Fraunces"))).toBe(true);
  expect((await proposalTheme(t.ctx, look, "nope")).ok).toBe(false);
});

test("a Look sketchbook draws no page, and its palette and type poster carry no copy", async () => {
  const look = await lookSketchbook();
  const mock = await generateSketchbook(t.ctx, cloud(), look, { kind: "mock" });
  expect(refusal(mock)).toContain("draws no page");
  const { sketchbook } = (await readSketchbook(t.root, look)) ?? {};
  const direction = sketchbook?.directions[0] as SketchbookDirection;
  const brief = { ...BRIEF, content: "UNIQUE-COPY-LINE" };
  for (const k of ["palette", "typeposter"]) {
    const prompt = kindPrompt(k, brief, direction, { fromBoard: false, subject: "look" });
    expect(prompt).not.toContain("UNIQUE-COPY-LINE");
    expect(kindPrompt(k, brief, direction, { fromBoard: false })).toContain("UNIQUE-COPY-LINE");
  }
});

// --- References, remix and nudges --------------------------------------------

/** A PNG `w`×`h`, as a browser screenshot would be. */
const png = (w: number, h: number) => Png.sync.write(new Png({ width: w, height: h }));

test("a reference comes from an upload, an asset or a URL, and the sweep keeps its image", async () => {
  const shoot = referenceCapture.shoot;
  const shot: string[] = [];
  referenceCapture.shoot = (async (opts: { url: string }) => {
    shot.push(opts.url);
    return { png: png(1200, 6000), finalUrl: opts.url, authWall: false, pageError: null };
  }) as unknown as typeof referenceCapture.shoot;
  try {
    await mkdir(join(t.root, "assets"), { recursive: true });
    await writeFile(join(t.root, "assets/shot.png"), png(40, 30));
    const r = await updateSketchbook(t.ctx, id, {
      references: [
        { data: `data:image/png;base64,${png(20, 10).toString("base64")}`, note: "its colour" },
        { path: "assets/shot.png" },
        { url: "https://example.com/pricing", note: "the big serif headlines" },
      ],
    });
    if (!r.ok) throw new Error(refusal(r));
    expect(shot).toEqual(["https://example.com/pricing"]);
    expect(r.value.references.map((x) => [x.id, x.path, x.url, x.note])).toEqual([
      ["ref", `assets/sketchbook/${id}/refs/ref.png`, undefined, "its colour"],
      ["shot", `assets/sketchbook/${id}/refs/shot.png`, undefined, ""],
      [
        "example-com-pricing",
        `assets/sketchbook/${id}/refs/example-com-pricing.png`,
        "https://example.com/pricing",
        "the big serif headlines",
      ],
    ]);
    // A long page is cut to its top, twice as tall as wide, and scaled to 1024 wide.
    const page = Png.sync.read(
      await readFile(join(t.root, `assets/sketchbook/${id}/refs/example-com-pricing.png`)),
    );
    expect([page.width, page.height]).toEqual([1024, 2048]);

    // Not an image, and a page that can't be screenshotted, are said plainly.
    const text = await updateSketchbook(t.ctx, id, {
      references: [
        { data: `data:image/png;base64,${Buffer.from("hello world!").toString("base64")}` },
      ],
    });
    expect(refusal(text)).toContain("isn't a PNG");
    referenceCapture.shoot = (async () => {
      const e = new Error("Chromium is not installed");
      e.name = "BrowserMissingError";
      throw e;
    }) as unknown as typeof referenceCapture.shoot;
    const noBrowser = await updateSketchbook(t.ctx, id, {
      references: [{ url: "https://example.org/" }],
    });
    expect(refusal(noBrowser)).toContain("velloo browser install");

    // Noted and removed by id; a removed one's image goes, the rest stay.
    const noted = await updateSketchbook(t.ctx, id, {
      references: [
        { id: "shot", note: "the spacing" },
        { id: "ref", remove: true },
      ],
    });
    if (!noted.ok) throw new Error(refusal(noted));
    expect(noted.value.references.map((x) => [x.id, x.note])).toEqual([
      ["shot", "the spacing"],
      ["example-com-pricing", "the big serif headlines"],
    ]);
    const files = await readdir(join(t.root, `assets/sketchbook/${id}/refs`));
    expect(files.sort()).toEqual(["example-com-pricing.png", "shot.png"]);
  } finally {
    referenceCapture.shoot = shoot;
  }
});

test("a direction's references go to the model after its mood board, said for what to take", async () => {
  listsKinds = true;
  await mkdir(join(t.root, "assets"), { recursive: true });
  await writeFile(join(t.root, "assets/a.png"), png(20, 10));
  await updateSketchbook(t.ctx, id, {
    brief: BRIEF,
    references: [{ path: "assets/a.png", note: "the dark palette" }],
  });
  const bad = await updateSketchbook(t.ctx, id, {
    directions: [
      { id: "poster", title: "Park poster", description: "Posters", references: ["nope"] },
    ],
  });
  expect(refusal(bad)).toContain('no reference "nope"');
  await updateSketchbook(t.ctx, id, {
    directions: [{ id: "poster", title: "Park poster", description: "Posters", references: ["a"] }],
  });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  expect(requests[0]?.reference).toHaveLength(1);
  expect(String(requests[0]?.prompt)).toContain(
    "The first attached image shows a site the person likes: take from it the dark palette, not its content, copy or layout.",
  );
  requests = [];
  await generateSketchbook(t.ctx, cloud(), id, { kind: "palette" });
  expect(requests[0]?.reference).toHaveLength(2);
  expect(String(requests[0]?.prompt)).toContain("The second attached image shows a site");
  const { sketchbook } = await read();
  const palette = of(sketchbook.directions[0], "palette")[0];
  expect(palette?.fromBoard).toBe(`assets/sketchbook/${id}/poster/board-1.png`);
  expect(palette?.sentWith).toEqual([`assets/sketchbook/${id}/refs/a.png`]);
});

test("a remix is a new direction from two, and its mood board is drawn from both of theirs", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  const r = await updateSketchbook(t.ctx, id, {
    remix: {
      from: ["poster", "instrument"],
      take: "colour from Park poster, type from Field instrument",
    },
  });
  if (!r.ok) throw new Error(refusal(r));
  const remix = r.value.directions[2];
  expect(remix).toMatchObject({
    id: "park-poster-field-instrument",
    title: "Park poster × Field instrument",
    remixOf: ["poster", "instrument"],
    take: "colour from Park poster, type from Field instrument",
    layout: "An illustrated hero",
  });
  expect(remix?.description).toContain("Park poster: Screen-printed park posters");
  expect(remix?.description).toContain("Field instrument: Swiss grid, safety orange");
  const same = await updateSketchbook(t.ctx, id, {
    remix: { from: ["poster", "poster"], take: "x" },
  });
  expect(same.ok).toBe(false);
  requests = [];
  await generateSketchbook(t.ctx, cloud(), id, {
    kind: "moodboard",
    directions: ["park-poster-field-instrument"],
  });
  expect(requests[0]?.reference).toHaveLength(2);
  expect(String(requests[0]?.prompt)).toContain(
    "This direction remixes two others, Park poster and Field instrument: the first and second attached images are their mood boards. Take colour from Park poster, type from Field instrument.",
  );
});

test("a mood board is revised like a mock: bolder, beside the one it revises", async () => {
  await updateSketchbook(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  await generateSketchbook(t.ctx, cloud(), id, { kind: "moodboard" });
  const board = `assets/sketchbook/${id}/poster/board-1.png`;
  requests = [];
  const r = await generateSketchbook(t.ctx, cloud(), id, {
    kind: "moodboard",
    revise: { image: board, instruction: REVISION_NUDGES.bolder },
  });
  if (!r.ok) throw new Error(refusal(r));
  expect(requests).toHaveLength(1);
  expect(requests[0]?.reference).toHaveLength(1);
  expect(String(requests[0]?.prompt)).toContain("Revise the attached mood board for Trailhead");
  expect(String(requests[0]?.prompt)).toContain("Change: Make it bolder");
  const { sketchbook } = await read();
  expect(of(sketchbook.directions[0], "moodboard").map((b) => b.revisedFrom)).toEqual([
    undefined,
    board,
  ]);
});
