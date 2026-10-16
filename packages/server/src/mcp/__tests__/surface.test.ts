import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applyMcpToolSurface,
  type McpSurfaceSelection,
  normalizeArguments,
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
  test("guided is the default and an unknown surface is rejected", () => {
    expect(parseMcpSurfaceSelection()).toEqual({ ok: true, selection: { mode: "guided" } });
    expect(parseMcpSurfaceSelection("full")).toEqual({ ok: true, selection: { mode: "full" } });
    expect(parseMcpSurfaceSelection("unknown")).toMatchObject({ ok: false });
  });

  test("URL helpers preserve the selection used by a shared daemon session", () => {
    const url = withMcpSurfaceUrl("http://127.0.0.1:7301/mcp", { mode: "guided" });
    expect(url).toBe("http://127.0.0.1:7301/mcp?surface=guided");
    expect(parseMcpSurfaceUrl(new URL(url).pathname + new URL(url).search)).toEqual({
      ok: true,
      selection: { mode: "guided" },
    });
  });

  test("a client config holding a removed profile selection still connects", () => {
    // The removed `profile` mode meant "native schemas, no façade" — that is
    // `full`. A stale URL must not fail the handshake.
    expect(parseMcpSurfaceSelection("profile")).toEqual({ ok: true, selection: { mode: "full" } });
    expect(parseMcpSurfaceUrl("/mcp?surface=guided&profile=three-variants")).toEqual({
      ok: true,
      selection: { mode: "guided" },
    });
    expect(
      withMcpSurfaceUrl("http://127.0.0.1:7301/mcp?profile=design-to-code", { mode: "full" }),
    ).toBe("http://127.0.0.1:7301/mcp?surface=full");
  });
});

describe("guided façade", () => {
  test("advertises four tools and dispatches a native operation", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const names = (await f.client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["call_velloo", "operation_schema", "read_velloo", "run_velloo_plan"]);
      const result = await f.client.callTool({
        name: "read_velloo",
        arguments: { operation: "list_screens", arguments: { mode: "full" } },
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('"mode":"full"');
    } finally {
      await f.close();
    }
  });

  test("reads and changes are separate tools, and a host can tell which is which", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const tools = (await f.client.listTools()).tools;
      const annotations = (name: string) => tools.find((tool) => tool.name === name)?.annotations;
      expect(annotations("read_velloo")?.readOnlyHint).toBe(true);
      expect(annotations("call_velloo")?.readOnlyHint).toBeUndefined();
    } finally {
      await f.close();
    }
  });

  test("the tools a session works through load upfront in Claude Code; the full surface stays deferred", async () => {
    const guided = await fixture({ mode: "guided" });
    const full = await fixture({ mode: "full" });
    try {
      const upfront = (tools: { name: string; _meta?: Record<string, unknown> | undefined }[]) =>
        tools
          .filter((tool) => tool._meta?.["anthropic/alwaysLoad"] === true)
          .map((tool) => tool.name)
          .sort();
      expect(upfront((await guided.client.listTools()).tools)).toEqual([
        "call_velloo",
        "read_velloo",
        "run_velloo_plan",
      ]);
      expect(upfront((await full.client.listTools()).tools)).toEqual([]);
    } finally {
      await guided.close();
      await full.close();
    }
  });

  test("an operation sent to the other tool is refused with the tool that takes it", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const read = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "list_screens", arguments: {} },
      });
      expect(read.isError).toBe(true);
      expect(textOf(read)).toContain('read_velloo { operation: "list_screens", arguments }');

      const change = await f.client.callTool({
        name: "read_velloo",
        arguments: { operation: "remove_screen", arguments: { id: "landing" } },
      });
      expect(change.isError).toBe(true);
      expect(textOf(change)).toContain('call_velloo { operation: "remove_screen", arguments }');
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

  test("answers operation_schema called through call_velloo instead of rejecting the enum", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const schema = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "operation_schema", arguments: { operation: "add_screen" } },
      });
      expect(schema.isError).toBeUndefined();
      const described = JSON.parse(textOf(schema)) as {
        operation: string;
        inputSchema: { required?: string[] };
      };
      expect(described.operation).toBe("add_screen");
      expect(described.inputSchema.required).toContain("name");

      const missing = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "operation_schema", arguments: {} },
      });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain('{ \\"operation\\": \\"<name>\\" }');

      const unknown = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "operation_schema", arguments: { operation: "nope" } },
      });
      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toContain('"kind":"UnknownOperation"');
    } finally {
      await f.close();
    }
  });

  test("takes a near-miss argument name with one reading, and says so", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const result = await f.client.callTool({
        name: "call_velloo",
        arguments: { operation: "add_screen", arguments: { screenName: "Settings" } },
      });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toContain('"added":"Settings"');
      expect(textOf(result)).toContain('"kind":"ArgumentsRenamed"');
      expect(textOf(result)).toContain('"screenName":"name"');
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
      const text = textOf(result);
      expect(text).toContain('"kind":"PlanFailed"');
      // The summary names the failing call and carries its error: a plan that
      // stops is actionable without re-reading the per-call content.
      expect(text).toContain('"failedAt":1');
      expect(text).toContain('"operation":"add_screen"');
      expect(text).toContain('"error":"');
      expect(text).toContain('"remaining":1');
      // `completed` counts what landed — the failed call is not one of them.
      expect(text).toContain('"completed":1');
      expect(f.writes).toEqual(["one"]);
    } finally {
      await f.close();
    }
  });
});

describe("native compatibility", () => {
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

  test("the guided enums are the whole catalogue, and there is no reveal tool", async () => {
    const f = await fixture({ mode: "guided" });
    try {
      const tools = (await f.client.listTools()).tools;
      const enumOf = (name: string) =>
        (
          (tools.find((tool) => tool.name === name)?.inputSchema.properties?.operation ?? {}) as {
            enum?: string[];
          }
        ).enum
          ?.slice()
          .sort();
      expect(enumOf("call_velloo")).toEqual(["add_screen", "operation_schema", "remove_screen"]);
      expect(enumOf("read_velloo")).toEqual(["list_screens", "operation_schema"]);
      // The schema tool describes native operations only, never itself.
      expect(enumOf("operation_schema")).toEqual(["add_screen", "list_screens", "remove_screen"]);
      expect(tools.map((tool) => tool.name)).not.toContain("reveal_tools");
    } finally {
      await f.close();
    }
  });
});

describe("normalizeArguments", () => {
  test("update_props { path, props } becomes one patch", () => {
    expect(
      normalizeArguments("update_props", {
        screenId: "home",
        path: "@cta",
        props: { children: "Save" },
        style: "px-4",
      }),
    ).toEqual({
      screenId: "home",
      patches: [{ path: "@cta", propPatch: { children: "Save" }, style: "px-4" }],
    });
  });

  test("propPatch spelled out works the same", () => {
    expect(
      normalizeArguments("update_props", { screenId: "home", path: [0], propPatch: { a: 1 } }),
    ).toEqual({ screenId: "home", patches: [{ path: [0], propPatch: { a: 1 } }] });
  });

  test("update_frame with one frame's fields inline becomes one patch", () => {
    expect(
      normalizeArguments("update_frame", { boardId: "b", frameId: "f-1", h: 1320, label: "Hi" }),
    ).toEqual({ boardId: "b", patches: [{ frameId: "f-1", patch: { h: 1320, label: "Hi" } }] });
    expect(normalizeArguments("update_frame", { boardId: "b", id: "f-1", h: 9 })).toEqual({
      boardId: "b",
      patches: [{ frameId: "f-1", patch: { h: 9 } }],
    });
  });

  test("update_board with the patch's fields inline becomes the patch", () => {
    expect(normalizeArguments("update_board", { boardId: "b", name: "Sign-up flow" })).toEqual({
      boardId: "b",
      patch: { name: "Sign-up flow" },
    });
    const documented = { boardId: "b", patch: { archived: true } };
    expect(normalizeArguments("update_board", documented)).toBe(documented);
    // Nothing to patch with is left for the schema to answer.
    const bare = { boardId: "b" };
    expect(normalizeArguments("update_board", bare)).toBe(bare);
  });

  test("connect_frames with one arrow's fields inline becomes one entry", () => {
    expect(
      normalizeArguments("connect_frames", {
        boardId: "b",
        from: "form-1",
        to: "taken-1",
        label: "Email taken",
        state: "error",
      }),
    ).toEqual({
      boardId: "b",
      edges: [{ from: "form-1", to: "taken-1", label: "Email taken", state: "error" }],
    });
    // No board named: the tool finds the one that holds both frames.
    expect(normalizeArguments("connect_frames", { from: "a", to: "b" })).toEqual({
      edges: [{ from: "a", to: "b" }],
    });
    expect(normalizeArguments("connect_frames", { arrows: [{ from: "a", to: "b" }] })).toEqual({
      edges: [{ from: "a", to: "b" }],
    });
    // The documented form is left exactly as sent.
    const documented = { boardId: "b", edges: [{ from: "a", to: "b", remove: true }] };
    expect(normalizeArguments("connect_frames", documented)).toBe(documented);
  });

  test("remove_frame finds the board that holds the frame", () => {
    const frames = () => [
      { boardId: "screens", frameId: "analytics-1", screenId: "analytics" },
      { boardId: "screens", frameId: "home-1", screenId: "home" },
      { boardId: "variants", frameId: "home-1", screenId: "home" },
    ];
    expect(normalizeArguments("remove_frame", { frameId: "analytics-1" }, frames)).toEqual({
      boardId: "screens",
      frameId: "analytics-1",
    });
    // Two boards have a `home-1`: which one is not ours to pick.
    const ambiguous = { frameId: "home-1" };
    expect(normalizeArguments("remove_frame", ambiguous, frames)).toBe(ambiguous);
    const named = { boardId: "variants", frameId: "home-1" };
    expect(normalizeArguments("remove_frame", named, frames)).toBe(named);
  });

  test("update_frame finds the frame by its screen, or its board by the frame", () => {
    const frames = () => [
      { boardId: "screens", frameId: "analytics-1", screenId: "analytics" },
      { boardId: "screens", frameId: "home-1", screenId: "home" },
      { boardId: "variants", frameId: "home-1", screenId: "home" },
    ];
    // The frame it was just given, named by its screen and sized in `height`.
    expect(
      normalizeArguments(
        "update_frame",
        { boardId: "screens", screenId: "analytics", h: 1135 },
        frames,
      ),
    ).toEqual({ boardId: "screens", patches: [{ frameId: "analytics-1", patch: { h: 1135 } }] });
    expect(
      normalizeArguments("update_frame", { frameId: "analytics-1", height: 992 }, frames),
    ).toEqual({
      boardId: "screens",
      patches: [{ frameId: "analytics-1", patch: { h: 992 } }],
    });
    // Two frames show `home`: which one is not ours to pick.
    const ambiguous = { screenId: "home", h: 900 };
    expect(normalizeArguments("update_frame", ambiguous, frames)).toBe(ambiguous);
    expect(normalizeArguments("update_frame", { frameId: "home-1", h: 900 }, frames)).toEqual({
      boardId: undefined,
      patches: [{ frameId: "home-1", patch: { h: 900 } }],
    });
  });

  test("component_status reads a list of names as its ids", () => {
    expect(normalizeArguments("component_status", { names: ["Button", "Card"] })).toEqual({
      ids: ["Button", "Card"],
    });
    const documented = { ids: ["Button"] };
    expect(normalizeArguments("component_status", documented)).toBe(documented);
  });

  test("compare_to_url's top-level url is the live source", () => {
    expect(normalizeArguments("compare_to_url", { screenId: "home", url: "http://x" })).toEqual({
      screenId: "home",
      source: { url: "http://x" },
    });
    const both = { screenId: "home", url: "http://x", source: { captureId: "c" } };
    expect(normalizeArguments("compare_to_url", both)).toBe(both);
  });

  test("add_note takes its text as content, and a title as its first line", () => {
    expect(normalizeArguments("add_note", { boardId: "main", content: "Fonts matched." })).toEqual({
      boardId: "main",
      body: "Fonts matched.",
    });
    expect(normalizeArguments("add_note", { title: "Setup", text: "Fonts matched." })).toEqual({
      body: "**Setup**\n\nFonts matched.",
    });
    const documented = { boardId: "main", x: 0, y: 0, body: "As written." };
    expect(normalizeArguments("add_note", documented)).toEqual(documented);
  });

  test("set_design_language takes the intent under the word an agent has for it, and rules as sentences", () => {
    expect(
      normalizeArguments("set_design_language", {
        description: "A terminal control desk.",
        rules: ["Keep every corner square", "Don't use blurred shadows", "Do: one filled button"],
      }),
    ).toEqual({
      intent: "A terminal control desk.",
      rules: [
        { kind: "do", text: "Keep every corner square" },
        { kind: "dont", text: "Don't use blurred shadows" },
        { kind: "do", text: "one filled button" },
      ],
    });
    expect(
      normalizeArguments("set_design_language", { dos: ["Square"], donts: ["Gradients"] }),
    ).toEqual({
      rules: [
        { kind: "do", text: "Square" },
        { kind: "dont", text: "Gradients" },
      ],
    });
    const documented = { intent: "x", rules: [{ kind: "dont", text: "Gradients" }] };
    expect(normalizeArguments("set_design_language", documented)).toEqual(documented);
  });

  test("batch takes the façade's own call vocabulary, alone or as entries", () => {
    const args = { name: "Card", tree: { $ref: "Box" } };
    expect(normalizeArguments("batch", { operation: "add_snippet", args })).toEqual({
      calls: [{ tool: "add_snippet", args }],
    });
    expect(
      normalizeArguments("batch", {
        calls: [
          { operation: "add_snippet", arguments: args },
          { tool: "remove_node", args: {} },
        ],
        atomic: false,
      }),
    ).toEqual({
      calls: [
        { tool: "add_snippet", args },
        { tool: "remove_node", args: {} },
      ],
      atomic: false,
    });
    const documented = { calls: [{ tool: "remove_node", args: {} }] };
    expect(normalizeArguments("batch", documented)).toEqual(documented);
  });

  test("batch reads `operations` as its calls, and each entry as the call it is", () => {
    // Both from one Sonnet run: the façade's word for the list, then entries
    // in the single-edit form `update_props` takes on its own.
    expect(
      normalizeArguments("batch", {
        operations: [
          {
            operation: "update_props",
            arguments: { screenId: "reviews", path: [1, 0], style: "w-[71%]" },
          },
        ],
      }),
    ).toEqual({
      calls: [
        {
          tool: "update_props",
          args: { screenId: "reviews", patches: [{ path: [1, 0], style: "w-[71%]" }] },
        },
      ],
    });
  });

  test("set_theme reads a role-to-family map as its font list", () => {
    expect(
      normalizeArguments("set_theme", {
        fonts: {
          display: "Archivo Black",
          sans: '"Inter", ui-sans-serif, system-ui',
          mono: { family: "IBM Plex Mono", google: true },
        },
      }),
    ).toEqual({
      fonts: [
        { role: "display", family: "Archivo Black" },
        { role: "sans", family: "Inter", fallback: "ui-sans-serif, system-ui" },
        { role: "mono", family: "IBM Plex Mono", google: true },
      ],
    });
    // One typeset as the object it is, its roles under a theme object's names.
    expect(
      normalizeArguments("set_theme", {
        typeset: { size: "16px", leading: "1.5", heading: "display", body: "sans" },
      }),
    ).toEqual({
      typeset: [{ size: "16px", leading: 1.5, fontHeading: "display", fontBody: "sans" }],
    });
    const documented = { fonts: [{ role: "sans", family: "Inter" }] };
    expect(normalizeArguments("set_theme", documented)).toBe(documented);
    const unreadable = { fonts: { sans: 14 } };
    expect(normalizeArguments("set_theme", unreadable)).toBe(unreadable);
  });

  test("component_status takes one component named on its own", () => {
    expect(normalizeArguments("component_status", { id: "ReviewCard" })).toEqual({
      ids: ["ReviewCard"],
    });
    expect(normalizeArguments("component_status", { ids: "Button", library: "ui" })).toEqual({
      ids: ["Button"],
      library: "ui",
    });
    const documented = { ids: ["Button"] };
    expect(normalizeArguments("component_status", documented)).toBe(documented);
    const screen = { screen: "home" };
    expect(normalizeArguments("component_status", screen)).toBe(screen);
  });

  test("the documented shape, and every other operation, pass through untouched", () => {
    const documented = { screenId: "home", patches: [{ path: [0] }] };
    expect(normalizeArguments("update_props", documented)).toBe(documented);
    const other = { screenId: "home", path: [0] };
    expect(normalizeArguments("remove_node", other)).toBe(other);
  });
});
