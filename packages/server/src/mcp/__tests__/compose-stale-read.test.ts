import { afterEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Node } from "@velloo/schema";
import { withActor } from "../../activity.ts";
import { updateProps } from "../../mutations/index.ts";
import { designScreen, type TestContext, testContext } from "../../testing/design-folder.ts";
import { registerComposeTool } from "../tools/compose.ts";
import { registerDiscoveryTools } from "../tools/discovery.ts";
import { registerMutationTools } from "../tools/mutations.ts";

/**
 * An agent replaces a tree from what it last read. A person editing the same
 * screen on the canvas in the meantime used to lose that edit without either
 * of them being told — and agent writes are off the undo stack, so it was gone.
 */

type ToolResult = { isError?: true; content: { type: string; text: string }[] };
type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

let t: TestContext;
afterEach(async () => {
  await t.cleanup();
});

const tree: Node = {
  $ref: "Card",
  $id: "card",
  props: { className: "p-4" },
  children: [
    { $ref: "Button", $id: "cta", props: { children: "Go" } },
    { $ref: "Text", $id: "note", props: { children: "Fine print" } },
  ],
};

async function setup() {
  t = await testContext({ label: "stale-read", screens: { home: designScreen("home", { tree }) } });
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerDiscoveryTools(mcp, t.ctx);
  registerMutationTools(mcp, t.ctx);
  registerComposeTool(mcp, t.ctx);
  const registered = (mcp as unknown as { _registeredTools: Record<string, { handler: Handler }> })
    ._registeredTools;
  /** A tool call made by agent session `session`. */
  const agent = (session: string) => async (name: string, args: Record<string, unknown>) => {
    const tool = registered[name];
    if (!tool) throw new Error(`no tool ${name}`);
    const result = await withActor({ source: "mcp", session }, () => tool.handler(args, {}));
    return { ...result, body: JSON.parse(result.content[0]?.text ?? "{}") };
  };
  /** An edit made on the canvas. */
  const person = (path: string, propPatch: Record<string, unknown>) =>
    withActor({ source: "canvas" }, () =>
      updateProps(t.ctx, { screenId: "home", patches: [{ path, propPatch }] }),
    );
  const saved = () => JSON.stringify(t.ctx.folder.screens.get("home")?.tree);
  return { agent: agent("a"), other: agent("b"), person, saved };
}

describe("a replace written from a read the screen has moved on from", () => {
  test("is refused, naming what changed, and the person's edit stays", async () => {
    const { agent, person, saved } = await setup();
    const { jsx } = (await agent("get_screen", { screenId: "home", mode: "jsx" })).body;
    expect((await person("@cta", { children: "Start free trial" })).ok).toBe(true);

    const written = await agent("compose", {
      screenId: "home",
      mode: "replace",
      jsx: (jsx as string).replace('className="p-4"', 'className="p-8"'),
    });
    expect(written.isError).toBe(true);
    expect(written.body).toMatchObject({ kind: "ScreenChangedSinceRead", changed: ["@cta"] });
    expect(written.body.hint).toContain('get_screen { screenId: "home", mode: "jsx" }');
    expect(saved()).toContain("Start free trial");
  });

  test("goes through once the agent reads again", async () => {
    const { agent, person, saved } = await setup();
    await agent("get_screen", { screenId: "home", mode: "jsx" });
    await person("@cta", { children: "Start free trial" });
    const { jsx } = (await agent("get_screen", { screenId: "home", mode: "jsx" })).body;
    const written = await agent("compose", {
      screenId: "home",
      mode: "replace",
      jsx: (jsx as string).replace('className="p-4"', 'className="p-8"'),
    });
    expect(written.isError).toBeUndefined();
    expect(saved()).toContain("Start free trial");
    expect(saved()).toContain("p-8");
  });

  test("of one node goes through when the edit was elsewhere on the screen", async () => {
    const { agent, person, saved } = await setup();
    await agent("get_screen", { screenId: "home", mode: "jsx" });
    await person("@note", { children: "Cancel anytime" });
    const written = await agent("compose", {
      screenId: "home",
      mode: "replace",
      path: "@cta",
      jsx: '<Button vellooId="cta">Begin</Button>',
    });
    expect(written.isError).toBeUndefined();
    expect(saved()).toContain("Cancel anytime");
    expect(saved()).toContain("Begin");
  });

  test("of one node is refused when the edit was inside it", async () => {
    const { agent, person } = await setup();
    await agent("get_screen", { screenId: "home", mode: "jsx" });
    await person("@cta", { children: "Start free trial" });
    const written = await agent("compose", {
      screenId: "home",
      mode: "replace",
      path: "@cta",
      jsx: '<Button vellooId="cta">Begin</Button>',
    });
    expect(written.body).toMatchObject({ kind: "ScreenChangedSinceRead", changed: ["@cta"] });
  });
});

describe("what the agent knows", () => {
  test("follows its own writes, so its edits never count against it", async () => {
    const { agent, saved } = await setup();
    const { jsx } = (await agent("get_screen", { screenId: "home", mode: "jsx" })).body;
    await agent("update_props", {
      screenId: "home",
      patches: [{ path: "@note", propPatch: { children: "x" } }],
    });
    const written = await agent("compose", { screenId: "home", mode: "replace", jsx });
    expect(written.isError).toBeUndefined();
    expect(saved()).toContain("Fine print");
  });

  test("is its own: another session's edit counts as someone else's", async () => {
    const { agent, other } = await setup();
    const { jsx } = (await agent("get_screen", { screenId: "home", mode: "jsx" })).body;
    await other("update_props", {
      screenId: "home",
      patches: [{ path: "@cta", propPatch: { children: "B" } }],
    });
    const written = await agent("compose", { screenId: "home", mode: "replace", jsx });
    expect(written.body).toMatchObject({ kind: "ScreenChangedSinceRead" });
  });

  test("is nothing until it reads or writes, and a first replace is let through", async () => {
    const { agent, person } = await setup();
    await person("@cta", { children: "Start free trial" });
    const written = await agent("compose", {
      screenId: "home",
      mode: "replace",
      jsx: '<Card vellooId="card" />',
    });
    expect(written.isError).toBeUndefined();
  });
});
