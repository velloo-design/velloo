import { beforeEach, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentContextCard } from "@velloo/protocol/agent";
import { type SketchbookFile, SketchbookFileSchema } from "@velloo/schema";
import { expandPrompt } from "../../agent/context.ts";
import { registerDiscoveryTools } from "../../mcp/tools/discovery.ts";
import type { McpResult } from "../../mcp/tools/result.ts";
import { registerSketchbookTools } from "../../mcp/tools/sketchbook.ts";
import {
  designBoard,
  designScreen,
  type TestContext,
  testContext,
} from "../../testing/design-folder.ts";
import { outputStatus, sketchbookLinks } from "../links.ts";
import { nextStep, recomposeStep, restyleStep, screensStep } from "../next.ts";
import {
  linkBuiltScreens,
  readSketchbook,
  readSketchbooks,
  updateSketchbook,
} from "../sketchbook.ts";

/**
 * A sketchbook's outputs are the one record of what it made: screens read
 * their inspiration from them, boards their chip, and a direction redrawn
 * after a screen was built marks that screen stale.
 */

const DIR = "assets/sketchbook/sb1/poster";
const image = (name: string, createdAt: string, extra: Record<string, string> = {}) => ({
  path: `${DIR}/${name}`,
  model: "m",
  prompt: "p",
  createdAt,
  ...extra,
});

const BOOK = {
  version: 1,
  name: "Pricing",
  stage: "screens",
  brief: { origin: "existing", product: "A park pass.", page: "Pricing" },
  buildBoard: "build",
  chosen: [
    { direction: "poster", image: `${DIR}/mock-1.png` },
    { direction: "poster", image: `${DIR}/mock-2.png` },
  ],
  directions: [
    {
      id: "poster",
      title: "Park poster",
      description: "Screen-printed park posters.",
      boards: [image("board-1.png", "2026-11-01T00:00:00Z")],
      mocks: [
        image("mock-1.png", "2026-11-02T00:00:00Z", { fromBoard: `${DIR}/board-1.png` }),
        image("mock-2.png", "2026-11-02T00:00:01Z", { fromBoard: `${DIR}/board-1.png` }),
      ],
    },
  ],
};

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    screens: { home: true, pricing: true, other: true },
    boards: {
      build: designBoard("build", ["home"], { theme: "poster" }),
      plain: designBoard("plain", ["other"]),
    },
    files: {
      "sketchbooks/sb1.json": BOOK,
      "looks/poster.json": { origin: { sketchbook: "sb1", direction: "poster" } },
    },
  });
});

const file = (patch: Partial<SketchbookFile> = {}): SketchbookFile =>
  SketchbookFileSchema.parse({ ...BOOK, ...patch });

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;
async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerSketchbookTools(mcp, t.ctx, undefined);
  registerDiscoveryTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const r = await (tools[name] as { handler: ToolHandler }).handler(args, {});
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  return { isError: r.isError === true, text, body: r.isError ? {} : JSON.parse(text) };
}

test("update_sketchbook records an output by screen, its direction read from the image", async () => {
  const r = await call("update_sketchbook", {
    id: "sb1",
    outputs: [{ screen: "home", image: `${DIR}/mock-1.png` }],
  });
  expect(r.isError).toBe(false);
  const again = await updateSketchbook(t.ctx, "sb1", {
    outputs: [{ screen: "home", image: `${DIR}/mock-2.png` }],
  });
  expect(again.ok).toBe(true);
  const outputs = (await readSketchbook(t.root, "sb1"))?.sketchbook.outputs ?? [];
  expect(outputs).toHaveLength(1);
  expect(outputs[0]).toMatchObject({
    screen: "home",
    direction: "poster",
    image: `${DIR}/mock-2.png`,
  });

  const wrong = await call("update_sketchbook", {
    id: "sb1",
    outputs: [{ screen: "home", image: `${DIR}/nope.png` }],
  });
  expect(wrong.isError).toBe(true);
  const noScreen = await call("update_sketchbook", {
    id: "sb1",
    outputs: [{ screen: "gone", image: `${DIR}/mock-1.png` }],
  });
  expect(noScreen.isError).toBe(true);
});

test("a screen goes stale when its direction draws past the image it was built from", () => {
  const at = "2026-11-03T00:00:00Z";
  const built = { direction: "poster", image: `${DIR}/mock-1.png`, at };
  expect(outputStatus(file(), built)).toEqual({ stale: false });

  // A revision of another mock is not this screen's business.
  const sibling = file({
    directions: [
      {
        ...file().directions[0],
        mocks: [
          ...(file().directions[0]?.mocks ?? []),
          image("mock-3.png", "2026-11-04T00:00:00Z", { revisedFrom: `${DIR}/mock-2.png` }),
        ],
      } as SketchbookFile["directions"][number],
    ],
  });
  expect(outputStatus(sibling, built).stale).toBe(false);

  // A revision of a revision of its mock is.
  const chain = file({
    directions: [
      {
        ...file().directions[0],
        mocks: [
          ...(file().directions[0]?.mocks ?? []),
          image("mock-3.png", "2026-11-04T00:00:00Z", { revisedFrom: `${DIR}/mock-1.png` }),
          image("mock-4.png", "2026-11-05T00:00:00Z", { revisedFrom: `${DIR}/mock-3.png` }),
        ],
      } as SketchbookFile["directions"][number],
    ],
  });
  expect(outputStatus(chain, built)).toEqual({ stale: true, newer: `${DIR}/mock-4.png` });

  // A screen built from the mood board follows only mood boards.
  const fromBoard = { direction: "poster", image: `${DIR}/board-1.png`, at };
  expect(outputStatus(chain, fromBoard).stale).toBe(false);
  const redrawn = file({
    directions: [
      {
        ...file().directions[0],
        boards: [
          ...(file().directions[0]?.boards ?? []),
          image("board-2.png", "2026-11-04T00:00:00Z"),
        ],
      } as SketchbookFile["directions"][number],
    ],
  });
  expect(outputStatus(redrawn, fromBoard)).toEqual({ stale: true, newer: `${DIR}/board-2.png` });
});

test("links: a screen's inspiration, and a board's sketchbooks through screens, build board and Look", async () => {
  await updateSketchbook(t.ctx, "sb1", {
    outputs: [{ screen: "home", image: `${DIR}/mock-1.png` }],
  });
  const links = sketchbookLinks(await readSketchbooks(t.root), t.ctx.folder);
  expect(links.screens.home).toMatchObject({
    sketchbook: "sb1",
    name: "Pricing",
    direction: "poster",
    directionTitle: "Park poster",
    stale: false,
  });
  expect(links.screens.other).toBeUndefined();
  expect(links.boards.build).toEqual([
    {
      sketchbook: "sb1",
      name: "Pricing",
      direction: "poster",
      step: "mocks",
      images: [`${DIR}/mock-1.png`, `${DIR}/mock-2.png`, `${DIR}/board-1.png`],
    },
  ]);
  expect(links.boards.plain).toBeUndefined();
  expect(links.looks).toEqual({ build: "poster" });

  // A deleted screen is simply not there.
  const gone = sketchbookLinks(await readSketchbooks(t.root), {
    ...t.ctx.folder,
    screens: new Map(),
  });
  expect(gone.screens.home).toBeUndefined();
});

test("get_screen carries inspiredBy, and get_sketchbook each output's staleness", async () => {
  await updateSketchbook(t.ctx, "sb1", {
    outputs: [{ screen: "home", image: `${DIR}/mock-1.png` }],
  });
  const screen = await call("get_screen", { screenId: "home" });
  expect(screen.body.inspiredBy).toEqual({
    sketchbook: "sb1",
    direction: "poster",
    image: `${DIR}/mock-1.png`,
  });
  const book = await call("get_sketchbook", { id: "sb1" });
  expect(book.body.sketchbook.outputs[0]).toMatchObject({ screen: "home", stale: false });
});

test("a screen that lands on the build board is linked when only one chosen image is left", async () => {
  // Two chosen images, one screen: which went with which is the agent's to say.
  await linkBuiltScreens(t.ctx, "build");
  expect((await readSketchbook(t.root, "sb1"))?.sketchbook.outputs).toEqual([]);

  await t.write("screens/pricing.json", designScreen("pricing"));
  await t.write(
    "boards/build.json",
    designBoard("build", ["home", "pricing"], { theme: "poster" }),
  );
  await t.reload();
  await updateSketchbook(t.ctx, "sb1", {
    outputs: [{ screen: "home", image: `${DIR}/mock-1.png` }],
  });
  await linkBuiltScreens(t.ctx, "build");
  const outputs = (await readSketchbook(t.root, "sb1"))?.sketchbook.outputs ?? [];
  expect(outputs.map((o) => [o.screen, o.image])).toEqual([
    ["home", `${DIR}/mock-1.png`],
    ["pricing", `${DIR}/mock-2.png`],
  ]);
});

test("the agent is told to record outputs, to recompose a stale one, and how to restyle", async () => {
  expect(screensStep(file())).toContain("update_sketchbook { outputs: [{ screen, image }] }");
  const stale = file({
    outputs: [
      {
        screen: "home",
        direction: "poster",
        image: `${DIR}/mock-1.png`,
        at: "2026-11-01T12:00:00Z",
      },
    ],
  });
  const next = nextStep({
    id: "sb1",
    sketchbook: stale,
    pending: [],
    promptChars: { moodboard: 0, mock: 0 },
  });
  expect(next).toContain("screen home");
  expect(next).toContain(`Recompose screen home from ${DIR}/mock-2.png`);
  expect(
    recomposeStep("sb1", stale, stale.outputs[0] as SketchbookFile["outputs"][number]),
  ).toContain(`outputs: [{ screen: "home", image: "${DIR}/mock-2.png" }]`);
  expect(restyleStep({ id: "home", name: "Home" }, "poster", "build")).toContain(
    'get_theme { theme: "poster" }',
  );
});

test("Restyle and Recompose cards expand to the work, in the design's ids", async () => {
  await updateSketchbook(t.ctx, "sb1", {
    outputs: [{ screen: "home", image: `${DIR}/mock-1.png` }],
  });
  const cards: AgentContextCard[] = [
    { kind: "restyle", ref: { boardId: "build", screenId: "home" }, label: "Restyle" },
    {
      kind: "recompose",
      ref: { boardId: "build", screenId: "home", sketchbook: "sb1" },
      label: "Recompose",
    },
  ];
  const text = await expandPrompt(
    { text: "Restyle it.", context: cards },
    t.ctx.folder,
    async () => null,
  );
  expect(text).toContain('Restyle screen "Home" (home) with the Look "poster"');
  expect(text).toContain(`Recompose screen home from ${DIR}/mock-1.png`);
});
