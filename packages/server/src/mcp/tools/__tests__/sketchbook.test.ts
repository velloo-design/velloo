import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import type { McpResult } from "../result.ts";
import { registerSketchbookTools } from "../sketchbook.ts";

/** The sketchbook tools as an agent calls them: every answer ends with what to do next. */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext;
afterEach(() => t?.cleanup());

async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerSketchbookTools(mcp, t.ctx, undefined, "http://127.0.0.1:7399");
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const result = await (tools[name] as { handler: ToolHandler }).handler(args, {});
  const first = result.content[0];
  return {
    result,
    isError: result.isError === true,
    body: JSON.parse(first?.type === "text" ? first.text : "{}") as Record<string, unknown>,
  };
}

const BRIEF = {
  origin: "existing" as const,
  product: "Trailhead, a hiking trip planner",
  page: "the landing page",
  content: "Hero: Plan less, hike more.",
  notes: "",
};

test("with none yet, the agent is told how one starts", async () => {
  t = await testContext();
  const { body } = await call("get_sketchbook");
  expect(body.sketchbook).toBeNull();
  expect(String(body.next)).toContain("There's no sketchbook yet");
});

test("a fresh sketchbook tells the agent to ask for the page and write the brief", async () => {
  t = await testContext();
  await call("update_sketchbook", { origin: "existing" });
  const { body } = await call("get_sketchbook");
  expect(String(body.next)).toContain("Ask the person which page");
  expect(String(body.next)).toContain("update_sketchbook { brief }");
});

test("the page picked on the canvas is what the agent is told to read", async () => {
  t = await testContext();
  await call("update_sketchbook", {
    origin: "existing",
    page: { label: "/pricing", route: "/pricing", file: "app/pricing/page.tsx" },
  });
  const { body } = await call("get_sketchbook");
  expect(String(body.next)).toContain(
    "The person picked the page to redesign: /pricing (route /pricing, served from app/pricing/page.tsx)",
  );
});

test("something new is asked about, not read", async () => {
  t = await testContext();
  await call("update_sketchbook", { origin: "new" });
  const { body } = await call("get_sketchbook");
  expect(String(body.next)).toContain("starting something new");
});

test("writing directions answers with the canvas to send the person to", async () => {
  t = await testContext();
  const { body } = await call("update_sketchbook", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  expect(body.stage).toBe("directions");
  expect(String(body.next)).toContain("http://127.0.0.1:7399/?view=sketchbook");
});

test("the screens step says whether paid images were allowed", async () => {
  t = await testContext();
  await call("update_sketchbook", { brief: BRIEF, stage: "screens" });
  expect(String((await call("get_sketchbook")).body.next)).toContain("Ask before drawing");
  await call("update_sketchbook", { generateImages: true });
  expect(String((await call("get_sketchbook")).body.next)).toContain("allowed paid images");
  await call("update_sketchbook", { generateImages: false });
  expect(String((await call("get_sketchbook")).body.next)).toContain("declined paid images");
});

test("images come with their file on disk, and can be inlined", async () => {
  t = await testContext();
  const made = await call("update_sketchbook", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  const fileOf = join(t.root, "sketchbooks", `${String(made.body.id)}.json`);
  // Record a board as a generation would have.
  await mkdir(join(t.root, "assets/sketchbook/poster"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(t.root, "assets/sketchbook/poster/board-1.png"), png);
  const file = JSON.parse(await Bun.file(fileOf).text());
  file.directions[0].images = [
    {
      kind: "moodboard",
      path: "assets/sketchbook/poster/board-1.png",
      model: "velloo-sketch",
      prompt: "p",
      createdAt: "2026-11-10T00:00:00Z",
    },
  ];
  await writeFile(fileOf, JSON.stringify(file));
  const { body, result } = await call("get_sketchbook", {
    inline: ["assets/sketchbook/poster/board-1.png"],
  });
  const sketchbook = body.sketchbook as { directions: { images: { file: string }[] }[] };
  expect(sketchbook.directions[0]?.images[0]?.file).toBe(
    join(t.root, "assets/sketchbook/poster/board-1.png"),
  );
  expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  const bad = await call("get_sketchbook", { inline: ["assets/elsewhere.png"] });
  expect(bad.isError).toBe(true);
});

test("generating without a cloud says how to get one, before anything is spent", async () => {
  t = await testContext();
  await call("update_sketchbook", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  const { isError, body } = await call("generate_sketchbook", { kind: "moodboard" });
  expect(isError).toBe(true);
  expect(JSON.stringify(body)).toContain("velloo login");
});
