import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { testContext } from "../../../testing/design-folder.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import type { McpResult } from "../result.ts";

/**
 * `get_theme` is where an agent learns the folder follows a design system.
 *
 * It hands back a PATH, never the prose. The document belongs to the repo and
 * goes on being edited there; returning what it said earlier is how a design
 * system and its stated rules drift apart. The agent opens the file itself.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let folder: Awaited<ReturnType<typeof testContext>>;

async function getTheme(): Promise<Record<string, unknown>> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerDiscoveryTools(mcp, folder.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const tool = tools.get_theme;
  if (!tool) throw new Error("get_theme not registered");
  const r = await tool.handler({}, {});
  return JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "{}");
}

beforeEach(async () => {
  folder = await testContext({ label: "get-theme-guidance", nested: true });
});
afterEach(async () => {
  await folder.cleanup();
});

const DESIGN_MD = `---
name: Acme
colors:
  primary: "#4f46e5"
---

## Do's and Don'ts

- Don't use two accents.
`;

describe("get_theme and the design system document", () => {
  test("no document ⇒ no key, so nothing is implied", async () => {
    const result = await getTheme();
    expect(result.designSystem).toBeUndefined();
    expect(result.colors).toBeTruthy();
  });

  test("hands back the path and tells the agent to read it", async () => {
    await writeFile(join(folder.root, "..", "DESIGN.md"), DESIGN_MD, "utf8");
    const result = await getTheme();
    const ds = result.designSystem as { path: string; note: string };
    expect(ds.path).toBe("../DESIGN.md");
    expect(ds.note).toContain("Read it before composing");
  });

  test("does not copy the prose into the response", async () => {
    // The whole point: no extract travels with the tokens.
    await writeFile(join(folder.root, "..", "DESIGN.md"), DESIGN_MD, "utf8");
    expect(JSON.stringify(await getTheme())).not.toContain("two accents");
  });
});
