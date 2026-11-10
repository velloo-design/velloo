import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addLookbookRequest, lookbookState, updateLookbook } from "../../../lookbook/lookbook.ts";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerLookbookTools } from "../lookbook.ts";
import type { McpResult } from "../result.ts";

/** The lookbook tools as an agent calls them: every answer ends with what to do next. */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext;
afterEach(() => t?.cleanup());

async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerLookbookTools(mcp, t.ctx, undefined, "http://127.0.0.1:7399");
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

test("a fresh lookbook tells the agent to write the brief", async () => {
  t = await testContext();
  const { body } = await call("get_lookbook");
  expect(body.started).toBe(false);
  expect(String(body.next)).toContain("Write the brief");
});

test("writing directions answers with the canvas to send the person to", async () => {
  t = await testContext();
  const { body } = await call("update_lookbook", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  expect(body.stage).toBe("directions");
  expect(String(body.next)).toContain("http://127.0.0.1:7399/?view=lookbook");
});

test("a request left on the canvas comes before anything else", async () => {
  t = await testContext();
  await call("update_lookbook", { brief: BRIEF });
  await addLookbookRequest(t.ctx, { kind: "propose-directions", text: "two more" });
  const { body } = await call("get_lookbook");
  expect(String(body.next)).toContain("1 request(s)");
  expect((await lookbookState(t.root)).lookbook.requests).toHaveLength(1);
});

test("images come with their file on disk, and can be inlined", async () => {
  t = await testContext();
  await updateLookbook(t.ctx, {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  // Record a board as a generation would have.
  await mkdir(join(t.root, "assets/lookbook/poster"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(join(t.root, "assets/lookbook/poster/board-1.png"), png);
  const file = JSON.parse(await Bun.file(join(t.root, "lookbook.json")).text());
  file.directions[0].boards = [
    {
      path: "assets/lookbook/poster/board-1.png",
      model: "velloo-sketch",
      prompt: "p",
      createdAt: "2026-11-10T00:00:00Z",
    },
  ];
  await writeFile(join(t.root, "lookbook.json"), JSON.stringify(file));
  const { body, result } = await call("get_lookbook", {
    inline: ["assets/lookbook/poster/board-1.png"],
  });
  const lookbook = body.lookbook as { directions: { boards: { file: string }[] }[] };
  expect(lookbook.directions[0]?.boards[0]?.file).toBe(
    join(t.root, "assets/lookbook/poster/board-1.png"),
  );
  expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  const bad = await call("get_lookbook", { inline: ["assets/elsewhere.png"] });
  expect(bad.isError).toBe(true);
});

test("generating without a cloud says how to get one, before anything is spent", async () => {
  t = await testContext();
  await call("update_lookbook", {
    brief: BRIEF,
    directions: [{ id: "poster", title: "Park poster", description: "Screen-printed posters" }],
  });
  const { isError, body } = await call("generate_lookbook", { kind: "moodboard" });
  expect(isError).toBe(true);
  expect(JSON.stringify(body)).toContain("velloo login");
});
