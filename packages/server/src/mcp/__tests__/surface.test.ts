import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyMcpToolSurface,
  type McpSurfaceSelection,
  parseMcpSurfaceSelection,
  parseMcpSurfaceUrl,
  withMcpSurfaceUrl,
} from "../surface.ts";
import { applyToolPolicy } from "../tool-policy.ts";
import { errorResult, jsonResult } from "../tools/result.ts";

async function fixture(selection: McpSurfaceSelection) {
  const mcp = new McpServer({ name: "surface-test", version: "0.0.0" });
  const surface = applyMcpToolSurface(mcp, selection);
  applyToolPolicy(mcp);
  const writes: string[] = [];

  mcp.registerTool(
    "list_screens",
    { description: "List screens", inputSchema: { mode: z.enum(["summary", "full"]).optional() } },
    async ({ mode }) => jsonResult({ screens: ["landing"], mode: mode ?? "summary" }),
  );
  mcp.registerTool(
    "add_screen",
    { description: "Add one screen", inputSchema: { name: z.string().min(1) } },
    async ({ name }) => {
      writes.push(name);
      return jsonResult({ added: name });
    },
  );
  mcp.registerTool(
    "remove_screen",
    { description: "Remove one screen", inputSchema: { id: z.string().min(1) } },
    async ({ id }) => errorResult({ kind: "ProtectedScreen", id }),
  );
  surface.finish();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "surface-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
  return {
    client,
    writes,
    async close() {
      await client.close();
      await mcp.close();
    },
  };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text?: string }[])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

describe("MCP surface selection", () => {
  test("guided is the default and selection rejects invalid combinations", () => {
    expect(parseMcpSurfaceSelection()).toEqual({ ok: true, selection: { mode: "guided" } });
    expect(parseMcpSurfaceSelection("profile", "three-variants")).toEqual({
      ok: true,
      selection: { mode: "profile", profile: "three-variants" },
    });
    expect(parseMcpSurfaceSelection("profile")).toMatchObject({ ok: false });
    expect(parseMcpSurfaceSelection("full", "local-comments")).toMatchObject({ ok: false });
    expect(parseMcpSurfaceSelection("unknown")).toMatchObject({ ok: false });
  });

  test("URL helpers preserve the selection used by a shared daemon session", () => {
    const url = withMcpSurfaceUrl("http://127.0.0.1:7301/mcp", {
      mode: "guided",
      profile: "design-to-code",
    });
    expect(url).toBe("http://127.0.0.1:7301/mcp?surface=guided&profile=design-to-code");
    expect(parseMcpSurfaceUrl(new URL(url).pathname + new URL(url).search)).toEqual({
      ok: true,
      selection: { mode: "guided", profile: "design-to-code" },
    });
  });
});

describe("guided façade", () => {
  test("advertises three tools and dispatches a native operation", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const names = (await f.client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["call_velloo", "operation_schema", "run_velloo_plan"]);
      const result = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "list_screens", arguments: { mode: "full" } },
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('"mode":"full"');
    } finally {
      await f.close();
    }
  });

  test("returns exact schema help for lookup, argument failures, and native errors", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const schema = await f.client.callTool({
        name: "operation_schema",
        arguments: { operation: "add_screen" },
      });
      const described = JSON.parse(textOf(schema)) as { inputSchema: { required?: string[] } };
      expect(described.inputSchema.required).toContain("name");

      const invalid = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "add_screen", arguments: {} },
      });
      expect(invalid.isError).toBe(true);
      expect(textOf(invalid)).toContain('"kind":"InvalidOperationArguments"');
      expect(textOf(invalid)).toContain('"required":["name"]');

      const nativeError = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "remove_screen", arguments: { id: "landing" } },
      });
      expect(nativeError.isError).toBe(true);
      expect(textOf(nativeError)).toContain('"kind":"ProtectedScreen"');
      expect(textOf(nativeError)).toContain('"kind":"OperationSchemaHelp"');
    } finally {
      await f.close();
    }
  });

  test("runs bounded sequential plans and stops at the first invalid call", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const result = await f.client.callTool({
        name: "run_velloo_plan",
        arguments: {
          calls: [
            { operation: "add_screen", arguments: { name: "one" } },
            { operation: "add_screen", arguments: {} },
            { operation: "add_screen", arguments: { name: "three" } },
          ],
        },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('"kind":"PlanFailed"');
      expect(f.writes).toEqual(["one"]);
    } finally {
      await f.close();
    }
  });
});

describe("native compatibility and profiles", () => {
  test("full keeps every native tool with no façade names", async () => {
    const f = await fixture({ mode: "full" });
    try {
      expect((await f.client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        "add_screen",
        "list_screens",
        "remove_screen",
      ]);
    } finally {
      await f.close();
    }
  });

  test("a native profile exposes only its preselected exact schemas", async () => {
    const f = await fixture({ mode: "profile", profile: "three-variants" });
    try {
      expect((await f.client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        "add_screen",
        "list_screens",
      ]);
    } finally {
      await f.close();
    }
  });

  test("a guided profile narrows the operation enum without a reveal tool", async () => {
    const f = await fixture({ mode: "guided", profile: "three-variants" });
    try {
      const call = (await f.client.listTools()).tools.find((tool) => tool.name === "call_velloo");
      const operation = (call?.inputSchema.properties?.operation ?? {}) as { enum?: string[] };
      expect(operation.enum).toContain("add_screen");
      expect(operation.enum).not.toContain("remove_screen");
      expect((await f.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
        "reveal_tools",
      );
    } finally {
      await f.close();
    }
  });
});
