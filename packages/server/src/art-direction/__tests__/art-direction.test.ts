import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ART_DIRECTION_LIMITS, describeArtDirectionFailures } from "@velloo/protocol";
import { expandPrompt } from "../../agent/context.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import {
  artDirectionState,
  buildArtDirection,
  createArtDirection,
  deleteArtDirection,
  generateArtDirection,
  listArtDirections,
  readArtDirection,
  removeArtDirectionImage,
  updateArtDirection,
} from "../art-direction.ts";
import { boardPrompt, MAX_IMAGE_PROMPT, mockPrompt } from "../prompts.ts";

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
/** The art direction each test works on, begun fresh. */
let id: string;

async function read() {
  const r = await readArtDirection(t.root, id);
  if (!r) throw new Error(`no art direction ${id}`);
  return r;
}

beforeEach(async () => {
  t = await testContext();
  const made = await createArtDirection(t.ctx);
  if (!made.ok) throw new Error("could not begin an art direction");
  id = made.value.id;
  requests = [];
  refuse = null;
  jpeg = false;
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

test("a new art direction starts at the brief, and the first directions move it on", async () => {
  expect((await read()).artDirection.stage).toBe("brief");
  const r = await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  expect(r.ok).toBe(true);
  const state = await artDirectionState(t.root, id);
  if (!state) throw new Error("gone");
  // The first directions move the stage on, so the canvas follows the agent.
  expect(state.artDirection.stage).toBe("directions");
  expect(state.artDirection.directions.map((d) => d.id)).toEqual([
    "poster",
    "instrument",
    "editorial",
  ]);
  expect(t.events).toContainEqual({ type: "art-direction-changed", id });
});

test("a new direction needs words to draw from; an existing one is patched by id", async () => {
  const missing = await updateArtDirection(t.ctx, id, { directions: [{ id: "x" }] });
  expect(missing.ok).toBe(false);
  await updateArtDirection(t.ctx, id, { directions: DIRECTIONS });
  await updateArtDirection(t.ctx, id, { directions: [{ id: "poster", dropped: true }] });
  const { artDirection } = await read();
  expect(artDirection.directions.find((d) => d.id === "poster")?.dropped).toBe(true);
  expect(artDirection.directions.find((d) => d.id === "poster")?.title).toBe("Park poster");
});

test("images need a brief and a cloud", async () => {
  await updateArtDirection(t.ctx, id, { directions: DIRECTIONS });
  const noBrief = await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  expect(noBrief.ok).toBe(false);
  await updateArtDirection(t.ctx, id, { brief: BRIEF });
  const noCloud = await generateArtDirection(t.ctx, undefined, id, { kind: "moodboard" });
  expect(noCloud.ok).toBe(false);
  expect(requests).toHaveLength(0);
});

test("a mood board per direction still in the running, stored under assets/artDirection", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  await updateArtDirection(t.ctx, id, { directions: [{ id: "editorial", dropped: true }] });
  const r = await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  // Each lands when it is drawn, in no fixed order.
  expect(r.value.made.map((m) => m.path).sort()).toEqual([
    `assets/art-direction/${id}/instrument/board-1.png`,
    `assets/art-direction/${id}/poster/board-1.png`,
  ]);
  expect(r.value.cost).toContain("cost $0.04");
  expect(requests.every((b) => b.intent === "moodboard")).toBe(true);
  expect(String(requests[0]?.prompt)).toContain("mood board for Trailhead");
  expect(
    (await stat(join(t.root, `assets/art-direction/${id}/poster/board-1.png`))).size,
  ).toBeGreaterThan(0);
  const { artDirection } = await read();
  expect(artDirection.stage).toBe("boards");
  expect(artDirection.directions[0]?.boards[0]?.model).toBe("velloo-sketch");
  // A regenerate draws the next board beside the first; the last is current.
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard", directions: ["poster"] });
  const again = await read();
  expect(again.artDirection.directions[0]?.boards.map((b) => b.path)).toEqual([
    `assets/art-direction/${id}/poster/board-1.png`,
    `assets/art-direction/${id}/poster/board-2.png`,
  ]);
});

test("mocks are drawn from the current mood board, mockCount per picked direction, with the page's copy", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS, mockCount: 2 });
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  await updateArtDirection(t.ctx, id, {
    directions: [
      { id: "instrument", picked: false },
      { id: "editorial", picked: false },
    ],
    models: { mock: "velloo-study" },
  });
  requests = [];
  const r = await generateArtDirection(t.ctx, cloud(), id, { kind: "mock" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made.map((m) => m.path).sort()).toEqual([
    `assets/art-direction/${id}/poster/mock-1.png`,
    `assets/art-direction/${id}/poster/mock-2.png`,
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.model).toBe("velloo-study");
  expect(String(requests[0]?.prompt)).toContain("attached mood board");
  expect(String(requests[0]?.prompt)).toContain("Plan less, hike more.");
  expect(String((requests[0]?.reference as string[] | undefined)?.[0])).toStartWith(
    "data:image/png;base64,",
  );
  const { artDirection } = await read();
  expect(artDirection.stage).toBe("mocks");
  expect(artDirection.directions[0]?.mocks[0]?.fromBoard).toBe(
    `assets/art-direction/${id}/poster/board-1.png`,
  );
});

test("with mood boards skipped, a mock is drawn from the direction's words", async () => {
  await updateArtDirection(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateArtDirection(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  expect(requests[0]?.reference).toBeUndefined();
  expect(String(requests[0]?.prompt)).toContain("Art direction: Park poster");
});

test("one refused image is reported beside the ones that landed", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS });
  refuse = (b) => String(b.prompt).includes("Outdoors editorial");
  const r = await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made).toHaveLength(2);
  expect(r.value.failed).toEqual([
    { direction: "editorial", message: expect.stringContaining("refused") },
  ]);
});

test("choosing mocks checks each exists, and deleting one unchooses it", async () => {
  await updateArtDirection(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  const wrong = await updateArtDirection(t.ctx, id, {
    chosen: [{ direction: "poster", mock: "assets/nope.png" }],
  });
  expect(wrong.ok).toBe(false);
  await generateArtDirection(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  const r = await updateArtDirection(t.ctx, id, {
    chosen: [{ direction: "poster", mock: `assets/art-direction/${id}/poster/mock-1.png` }],
  });
  expect(r.ok && r.value.chosen).toHaveLength(1);
  // Deleting the chosen mock clears the choice and the file.
  await removeArtDirectionImage(t.ctx, id, `assets/art-direction/${id}/poster/mock-1.png`);
  const { artDirection } = await read();
  expect(artDirection.chosen).toEqual([]);
  expect(
    await readFile(join(t.root, `assets/art-direction/${id}/poster/mock-1.png`)).catch(() => null),
  ).toBeNull();
});

test("deleting an art direction takes its images and leaves the others", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  const other = await createArtDirection(t.ctx, { origin: "new" });
  if (!other.ok) throw new Error("could not begin another");
  await deleteArtDirection(t.ctx, id);
  expect(await artDirectionState(t.root, id)).toBeNull();
  expect(await stat(join(t.root, `assets/art-direction/${id}`)).catch(() => null)).toBeNull();
  expect((await listArtDirections(t.root)).map((a) => a.id)).toEqual([other.value.id]);
});

test("a cloud that sends JPEG gets .jpg files, sized from the JPEG", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 1) });
  jpeg = true;
  const r = await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.made[0]?.path).toBe(`assets/art-direction/${id}/poster/board-1.jpg`);
  const { artDirection } = await read();
  expect(artDirection.directions[0]?.boards[0]).toMatchObject({ width: 16, height: 8 });
  // The next draw counts the .jpg as taken.
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  expect((await read()).artDirection.directions[0]?.boards[1]?.path).toBe(
    `assets/art-direction/${id}/poster/board-2.jpg`,
  );
});

test("mocks wait for a direction's mood board unless mood boards are skipped", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  // The board for one direction failed to draw: no mock is drawn from words in its place.
  refuse = (b) => String(b.prompt).includes("Field instrument");
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  requests = [];
  const r = await generateArtDirection(t.ctx, cloud(), id, { kind: "mock", count: 1 });
  expect(r.ok).toBe(false);
  if (!r.ok && r.error.kind === "BadRequest")
    expect(r.error.message).toContain('"Field instrument" has no mood board yet');
  expect(requests).toHaveLength(0);
});

test("the longest brief and direction the limits allow still fit one image prompt", async () => {
  const fill = (n: number) => "w ".repeat(n / 2);
  const brief = {
    origin: "existing" as const,
    product: fill(ART_DIRECTION_LIMITS.product),
    page: fill(ART_DIRECTION_LIMITS.page),
    content: fill(ART_DIRECTION_LIMITS.content),
    notes: fill(ART_DIRECTION_LIMITS.notes),
  };
  const direction = {
    id: "long",
    title: "x".repeat(80),
    description: fill(ART_DIRECTION_LIMITS.description),
    layout: fill(ART_DIRECTION_LIMITS.layout),
    dropped: false,
    picked: true,
    boards: [],
    mocks: [],
  };
  for (const fromBoard of [true, false]) {
    expect(mockPrompt(brief, direction, { fromBoard }).length).toBeLessThanOrEqual(
      MAX_IMAGE_PROMPT,
    );
  }
  expect(boardPrompt(brief, direction).length).toBeLessThanOrEqual(MAX_IMAGE_PROMPT);
});

test("the same failure for every image is said once; different ones by direction", () => {
  const same = describeArtDirectionFailures([
    { direction: "a", message: "No image provider." },
    { direction: "b", message: "No image provider." },
  ]);
  expect(same).toBe("No image provider.");
  const mixed = describeArtDirectionFailures(
    [
      { direction: "a", message: "Refused." },
      { direction: "b", message: "Timed out." },
    ],
    (id) => id.toUpperCase(),
  );
  expect(mixed).toBe("A: Refused.\nB: Timed out.");
});

test("the art direction card tells the agent where the person is and what they picked", async () => {
  await updateArtDirection(t.ctx, id, {
    origin: "existing",
    page: { label: "/pricing", file: "app/pricing/page.tsx" },
  });
  const text = await expandPrompt(
    {
      text: "Start Velloo art direction for this app.",
      context: [
        {
          kind: "art-direction",
          ref: { step: "brief", artDirection: id },
          label: "Art direction · Brief",
        },
      ],
    },
    t.ctx.folder,
    async () => null,
  );
  expect(text.startsWith("Start Velloo art direction for this app.")).toBe(true);
  expect(text).toContain("on its brief step");
  expect(text).toContain(`get_art_direction { id: "${id}" }`);
  expect(text).toContain("The person picked the page to redesign: /pricing");
});

test("a design keeps several art directions, the one changed last first", async () => {
  const second = await createArtDirection(t.ctx, { origin: "new", name: "Night mode" });
  if (!second.ok) throw new Error("could not begin another");
  // The order is by the time of the last write, to the millisecond.
  await Bun.sleep(5);
  await updateArtDirection(t.ctx, id, { brief: BRIEF });
  const list = await listArtDirections(t.root);
  expect(list.map((a) => a.id)).toEqual([id, second.value.id]);
  expect(list[0]?.name).toBe("the landing page");
  expect(list[1]?.name).toBe("Night mode");
});

test("the single art direction of an older design becomes the first of its list", async () => {
  const legacy = await testContext();
  try {
    await writeFile(
      join(legacy.root, "art-direction.json"),
      JSON.stringify({
        version: 1,
        stage: "mocks",
        brief: BRIEF,
        chosen: { direction: "poster", mock: "assets/art-direction/poster/mock-1.png" },
      }),
    );
    const [only] = await listArtDirections(legacy.root);
    expect(only?.stage).toBe("mocks");
    const read = only ? await readArtDirection(legacy.root, only.id) : null;
    // A file from before several mocks could be chosen reads as a list of one.
    expect(read?.artDirection.chosen).toEqual([
      { direction: "poster", mock: "assets/art-direction/poster/mock-1.png" },
    ]);
    expect(await stat(join(legacy.root, "art-direction.json")).catch(() => null)).toBeNull();
  } finally {
    await legacy.cleanup();
  }
});

test("building makes the board the screens go on, once, and keeps what the person added", async () => {
  await updateArtDirection(t.ctx, id, {
    brief: BRIEF,
    directions: DIRECTIONS.slice(0, 1),
    skipBoards: true,
  });
  await generateArtDirection(t.ctx, cloud(), id, { kind: "mock", count: 2 });
  const chosen = [1, 2].map((n) => ({
    direction: "poster",
    mock: `assets/art-direction/${id}/poster/mock-${n}.png`,
  }));
  const built = await buildArtDirection(t.ctx, id, {
    chosen,
    generateImages: false,
    instructions: "Keep the navigation",
  });
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  expect(t.ctx.folder.boards.get(built.value.boardId)?.name).toBe(
    "Art direction · the landing page",
  );
  const { artDirection } = await read();
  expect(artDirection.stage).toBe("build");
  expect(artDirection.chosen).toEqual(chosen);
  expect(artDirection.buildBoard).toBe(built.value.boardId);
  expect(artDirection.buildNotes).toBe("Keep the navigation");
  const again = await buildArtDirection(t.ctx, id, {
    chosen,
    generateImages: false,
    instructions: "",
  });
  expect(again.ok && again.value.boardId).toBe(built.value.boardId);
});

test("images are recorded as each lands, not when the last one does", async () => {
  await updateArtDirection(t.ctx, id, { brief: BRIEF, directions: DIRECTIONS.slice(0, 2) });
  const before = t.events.filter((e) => e.type === "art-direction-changed").length;
  await generateArtDirection(t.ctx, cloud(), id, { kind: "moodboard" });
  // Two pending marks, two images recorded, two pending cleared.
  const after = t.events.filter((e) => e.type === "art-direction-changed").length;
  expect(after - before).toBeGreaterThanOrEqual(6);
});
