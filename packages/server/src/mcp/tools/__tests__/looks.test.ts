import { beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { designBoard, type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import { registerLookTools } from "../looks.ts";
import type { McpResult } from "../result.ts";

/** What an agent sees of a Look: get_theme reads it, update_look writes it, get_board carries its rules. */

let t: TestContext;
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerLookTools(mcp, t.ctx);
  registerDiscoveryTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const r = await (tools[name] as { handler: ToolHandler }).handler(args, {});
  const body = JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "{}");
  return { isError: r.isError === true, body };
}

const BOARD = "assets/sketchbook/sb1/poster/board-1.png";

beforeEach(async () => {
  t = await testContext({ boards: { main: designBoard("main", []) } });
  const put = async (path: string, body: string) => {
    await mkdir(dirname(join(t.root, path)), { recursive: true });
    await writeFile(join(t.root, path), body);
  };
  await put(BOARD, "x");
  await put(
    "sketchbooks/sb1.json",
    JSON.stringify({
      version: 1,
      chosen: [],
      directions: [
        {
          id: "poster",
          title: "Park poster",
          description: "Screen-printed park posters.",
          images: [
            {
              kind: "moodboard",
              path: BOARD,
              model: "m",
              prompt: "p",
              createdAt: "2026-11-13T00:00:00Z",
            },
          ],
        },
      ],
    }),
  );
});

test("fromSketchbook makes the Look and says to set its tokens from the images", async () => {
  const made = await call("update_look", {
    fromSketchbook: { sketchbook: "sb1", direction: "poster" },
  });
  expect(made.isError).toBe(false);
  expect(made.body.theme).toBe("Park poster");
  expect(made.body.look.images[0].file).toBe(join(t.root, BOARD));
  expect(made.body.next).toContain('set_theme { theme: "Park poster" }');

  const read = await call("get_theme", { theme: "Park poster" });
  expect(read.body.look.origin).toEqual({ sketchbook: "sb1", direction: "poster" });
  expect((await call("get_theme")).body.look).toBeNull();
});

test("a board on a Look with rules carries them", async () => {
  await call("update_look", { fromSketchbook: { sketchbook: "sb1", direction: "poster" } });
  const written = await call("update_look", {
    theme: "Park poster",
    rules: { donts: ["No drop shadows"] },
  });
  expect(written.body.look.rules).toEqual({ dos: [], donts: ["No drop shadows"] });
  const boardId = "main";
  const board = t.folder.boards.get(boardId);
  if (!board) throw new Error("the scaffold has no board");
  expect((await call("get_board", { boardId })).body.look).toBeUndefined();
  t.folder.boards.set(boardId, { ...board, theme: "Park poster" });
  const read = await call("get_board", { boardId });
  expect(read.body.look.rules.donts).toEqual(["No drop shadows"]);
});

test("a Look that doesn't exist is an error that names the ones that do", async () => {
  const r = await call("update_look", { theme: "Nope", imagery: "x" });
  expect(r.isError).toBe(true);
  expect(JSON.stringify(r.body)).toContain("default");
});
