import { afterEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import { registerNoteTools } from "../notes.ts";
import type { McpResult } from "../result.ts";

/**
 * Leaving a note is the last thing a setup does, and the call an agent makes
 * for it names neither a board nor coordinates — it does not know either yet.
 */
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext;
afterEach(async () => {
  await t.cleanup();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerNoteTools(mcp, t.ctx);
  registerDiscoveryTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const result = await (tools[name] as { handler: ToolHandler }).handler(args, {});
  const body = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}");
  return { body: body as Record<string, unknown>, isError: result.isError === true };
}

const board = {
  id: "main",
  name: "Main",
  frames: [{ id: "f1", screen: "home", x: 200, y: 120, w: 1440, h: 900 }],
  groups: [],
};

describe("notes without a board or a place named", () => {
  test("a note goes on the design's first board, beside its frames, and a second below it", async () => {
    t = await testContext({ label: "notes", screens: { home: true }, boards: { main: board } });
    expect((await call("add_note", { body: "Setup: fonts matched." })).isError).toBe(false);
    await call("add_note", { body: "Unverified: dark mode." });
    const notes = t.ctx.folder.notes.get("main") ?? [];
    expect(notes.map((note) => [note.x, note.y])).toEqual([
      [200 - 240 - 48, 120],
      [200 - 240 - 48, 120 + 280],
    ]);
  });

  test("a place that is named is kept", async () => {
    t = await testContext({ label: "notes", screens: { home: true }, boards: { main: board } });
    await call("add_note", { boardId: "main", x: 10, y: 20, body: "Here." });
    expect(t.ctx.folder.notes.get("main")?.[0]).toMatchObject({ x: 10, y: 20 });
  });

  test("list_notes with no board lists every board's, and says which board each is on", async () => {
    t = await testContext({ label: "notes", screens: { home: true }, boards: { main: board } });
    await call("add_note", { body: "Setup: fonts matched." });
    const { body } = await call("list_notes");
    expect(body.notes).toEqual([
      expect.objectContaining({ boardId: "main", body: "Setup: fonts matched." }),
    ]);
  });

  test("a design with no board says where the note's content should go instead", async () => {
    t = await testContext({ label: "notes" });
    const added = await call("add_note", { body: "Setup: fonts matched." });
    expect(added.isError).toBe(true);
    expect(String(added.body.message)).toContain("in your reply to the user");
    const listed = await call("list_notes");
    expect(listed.isError).toBe(false);
    expect(listed.body.notes).toEqual([]);
  });
});

describe("annotations without a screen named", () => {
  test("list_annotations lists every screen's, and says which screen each is on", async () => {
    t = await testContext({
      label: "annotations",
      screens: { home: true, pricing: true },
      boards: { main: board },
    });
    await call("add_annotation", { screenId: "pricing", path: [], body: "Lead with the price." });
    const all = await call("list_annotations");
    expect(all.isError).toBe(false);
    expect(all.body.annotations).toEqual([
      expect.objectContaining({ screenId: "pricing", body: "Lead with the price.", resolved: [] }),
    ]);
    const one = (await call("list_annotations", { screenId: "home" })).body;
    expect(one.annotations).toEqual([]);
  });
});
