import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../design-folder.ts";
import { registerDiscoveryTools } from "../mcp/tools/discovery.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * `component_status` is the tool an agent is told to consult before claiming
 * the canvas renders an app component exactly, so its answers have to be
 * unambiguous. A production-like evaluation caught the gap this guards: a
 * model asked about the app's OWN component names (Panel, StatusChip, Manifest) and got the same
 * `unavailable` it would get for a broken library component, which reads as
 * "the canvas is broken" rather than "those are not library ids".
 */
async function fixture() {
  const mcp = new McpServer({ name: "component-status-test", version: "0.0.0" });
  const provider = createShadcnProvider();
  const folder = {
    root: "/tmp/nonexistent",
    config: { defaultLibrary: "shadcn", libraries: {}, extensions: {} },
    snippets: new Map(),
  } as unknown as DesignFolder;
  const ctx = {
    folder,
    providers: { shadcn: provider },
    defaultProvider: provider,
    broadcast: () => undefined,
  } as unknown as MutationContext;
  registerDiscoveryTools(mcp, ctx);

  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(b), client.connect(a)]);
  return {
    async status(ids: string[]) {
      const res = await client.callTool({ name: "component_status", arguments: { ids } });
      const text = (res.content as { type: string; text: string }[])[0]?.text ?? "{}";
      return JSON.parse(text) as {
        diagnostics: { id: string; status: string; note?: string }[];
      };
    },
  };
}

describe("component_status", () => {
  test("reports an id outside the library as unknown, not unavailable", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Panel", "StatusChip", "Manifest"]);
    expect(diagnostics.map((d) => d.status)).toEqual(["unknown", "unknown", "unknown"]);
    // The note has to send the agent to the right place — the ids are wrong,
    // the canvas is not broken.
    expect(diagnostics[0]?.note).toContain("list_components");
  });

  test("a known component is not reported as unknown", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Button"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.status).not.toBe("unknown");
  });

  test("known and unknown ids in one call are separated", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Button", "Panel"]);
    const byId = new Map(diagnostics.map((d) => [d.id, d.status]));
    expect(byId.get("Panel")).toBe("unknown");
    expect(byId.get("Button")).not.toBe("unknown");
  });
});
