import { afterEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { designConfig, type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import type { McpResult } from "../result.ts";

/**
 * What the session brief leaves to the first reads. The brief has to fit what
 * a client shows, so a framework's detail rides on `list_components`' index
 * and the app's JavaScript theme on `get_theme`.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

async function call(tool: string, args: Record<string, unknown> = {}) {
  if (!t) throw new Error("no folder");
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerDiscoveryTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const r = await tools[tool]?.handler(args, {});
  return JSON.parse(r?.content[0]?.type === "text" ? r.content[0].text : "{}") as Record<
    string,
    unknown
  >;
}

describe("what the brief hands to the first reads", () => {
  test("the unfiltered index carries the framework's notes; a narrowed read does not", async () => {
    t = await testContext({
      label: "brief-handoff",
      provider: createMuiProvider(),
      config: designConfig({
        library: { id: "mui", version: "t", source: "binary", componentsPath: "binary" },
      }),
    });
    const index = await call("list_components");
    expect((index.framework as string[]).join(" ")).toContain("`createTheme(...)`");
    expect((await call("list_components", { filter: "Button" })).framework).toBeUndefined();
  });

  test("get_theme names the JavaScript theme init read the app's from", async () => {
    t = await testContext({
      label: "brief-handoff",
      config: designConfig({ themeSource: { kind: "mantine", files: ["src/theme.ts"] } }),
    });
    expect(await call("get_theme")).toMatchObject({
      appTheme: expect.stringContaining("`src/theme.ts`"),
    });
  });

  test("a theme read from a stylesheet needs no note", async () => {
    t = await testContext({ label: "brief-handoff" });
    expect((await call("get_theme")).appTheme).toBeUndefined();
  });
});
