import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { updateArtDirection } from "../../../art-direction/art-direction.ts";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerArtDirectionTools } from "../art-direction.ts";
import type { McpResult } from "../result.ts";

/** The art direction tools as an agent calls them: every answer ends with what to do next. */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext;
afterEach(() => t?.cleanup());

async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerArtDirectionTools(mcp, t.ctx, undefined, "http://127.0.0.1:7399");
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

test("a fresh art direction tells the agent to write the brief", async () => {
  t = await testContext();
  const { body } = await call("get_art_direction");
  expect(body.started).toBe(false);
  expect(String(body.next)).toContain("Write the brief");
});

test("writing directions answers with the canvas to send the person to", async () => {
  t = await testContext();
  const { body } = await call("update_art_direction", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  expect(body.stage).toBe("directions");
  expect(String(body.next)).toContain("http://127.0.0.1:7399/?view=art-direction");
});

test("the build step says whether paid images were allowed", async () => {
  t = await testContext();
  await call("update_art_direction", { brief: BRIEF, stage: "build" });
  expect(String((await call("get_art_direction")).body.next)).toContain(
    "Ask the person before drawing",
  );
  await call("update_art_direction", { generateImages: true });
  expect(String((await call("get_art_direction")).body.next)).toContain("allowed paid images");
  await call("update_art_direction", { generateImages: false });
  expect(String((await call("get_art_direction")).body.next)).toContain("declined paid images");
});

test("images come with their file on disk, and can be inlined", async () => {
  t = await testContext();
  await updateArtDirection(t.ctx, {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  // Record a board as a generation would have.
  await mkdir(join(t.root, "assets/art-direction/poster"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(t.root, "assets/art-direction/poster/board-1.png"), png);
  const file = JSON.parse(await Bun.file(join(t.root, "art-direction.json")).text());
  file.directions[0].boards = [
    {
      path: "assets/art-direction/poster/board-1.png",
      model: "velloo-sketch",
      prompt: "p",
      createdAt: "2026-11-10T00:00:00Z",
    },
  ];
  await writeFile(join(t.root, "art-direction.json"), JSON.stringify(file));
  const { body, result } = await call("get_art_direction", {
    inline: ["assets/art-direction/poster/board-1.png"],
  });
  const artDirection = body.artDirection as { directions: { boards: { file: string }[] }[] };
  expect(artDirection.directions[0]?.boards[0]?.file).toBe(
    join(t.root, "assets/art-direction/poster/board-1.png"),
  );
  expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  const bad = await call("get_art_direction", { inline: ["assets/elsewhere.png"] });
  expect(bad.isError).toBe(true);
});

test("generating without a cloud says how to get one, before anything is spent", async () => {
  t = await testContext();
  await call("update_art_direction", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  const { isError, body } = await call("generate_art_direction", { kind: "moodboard" });
  expect(isError).toBe(true);
  expect(JSON.stringify(body)).toContain("velloo login");
});
