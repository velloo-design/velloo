import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { testContext } from "../../../testing/design-folder.ts";
import { setGuidance } from "../../../theme/guidance.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import type { McpResult } from "../result.ts";

/**
 * `get_theme` is where an agent meets the folder's design guidance. It rides
 * on this response rather than becoming another advertised MCP resource: the
 * prose is free here, and a resource listing is not — it is paid for at every
 * handshake, by every session, whether or not a folder has any guidance.
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
  folder = await testContext({ label: "get-theme-guidance" });
});
afterEach(async () => {
  await folder.cleanup();
});

describe("get_theme and design guidance", () => {
  test("absent ⇒ no guidance key, so nothing is implied", async () => {
    const result = await getTheme();
    expect(result.guidance).toBeUndefined();
    expect(result.guidanceNote).toBeUndefined();
    // The tokens are still there.
    expect(result.colors).toBeTruthy();
  });

  test("present ⇒ the prose rides along with the tokens", async () => {
    await setGuidance(folder.ctx.folder, "## Do's and Don'ts\n\n- One accent per screen.");
    const result = await getTheme();
    expect(result.guidance).toContain("One accent per screen.");
    expect(result.guidanceNote).toContain("before composing");
  });

  test("whitespace-only guidance counts as absent", async () => {
    await setGuidance(folder.ctx.folder, "   \n  ");
    expect((await getTheme()).guidance).toBeUndefined();
  });
});

describe("get_theme and the folder's stated rules", () => {
  test("splits the Do's and Don'ts out so a reviewer can quote them", async () => {
    await setGuidance(
      folder.ctx.folder,
      "## Overview\n\nCalm.\n\n## Do's and Don'ts\n\n- Do keep contrast high.\n- Don't use two accents.\n",
    );
    const result = await getTheme();
    expect(result.guidanceRules).toEqual([
      { index: 1, kind: "do", text: "Do keep contrast high." },
      { index: 2, kind: "dont", text: "Don't use two accents." },
    ]);
    expect(result.guidanceNote).toContain("2 stated rule(s)");
    expect(result.guidanceNote).toContain("skip any you cannot actually check");
  });

  test("guidance without a rules section omits the key rather than sending []", async () => {
    await setGuidance(folder.ctx.folder, "## Overview\n\nCalm.");
    const result = await getTheme();
    expect(result.guidance).toContain("Calm.");
    expect(result.guidanceRules).toBeUndefined();
    // The note must not promise rules that aren't there.
    expect(result.guidanceNote).not.toContain("stated rule");
  });
});
