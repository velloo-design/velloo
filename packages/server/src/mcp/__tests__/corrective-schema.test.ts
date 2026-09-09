import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { loadDesignFolder } from "../../design-folder.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { designConfig, designTheme } from "../../testing/design-folder.ts";
import { applyMcpToolSurface } from "../surface.ts";
import { applyToolPolicy } from "../tool-policy.ts";
import { registerAssetTools } from "../tools/assets.ts";
import { registerBatchTool } from "../tools/batch.ts";
import { registerCaptureTools } from "../tools/captures.ts";
import { registerCommentTools } from "../tools/comments.ts";
import { registerComposeTool } from "../tools/compose.ts";
import { registerDiscoveryTools } from "../tools/discovery.ts";
import { registerEmitTools } from "../tools/emit.ts";
import { registerExtensionTools } from "../tools/extensions.ts";
import { registerFeedbackTool } from "../tools/feedback.ts";
import { registerGenerateTools } from "../tools/generate.ts";
import { registerInspectTool } from "../tools/inspect.ts";
import { registerMutationTools } from "../tools/mutations.ts";
import { registerNoteTools } from "../tools/notes.ts";
import { registerScreenshotTool } from "../tools/screenshot.ts";
import { registerThemeTools } from "../tools/theme.ts";

/**
 * A mis-shaped call recovers in one round trip, for *every* operation.
 *
 * The guided surface embeds the failing operation's exact schema in its own
 * failure, which is why an agent that gets an argument wrong fixes it
 * immediately instead of guessing. That property is uniform by construction —
 * and it degrades per-operation and in silence: `z.toJSONSchema` throws on a
 * schema carrying a transform, and the catch turns that into a placeholder
 * with no properties at all. One operation would lose the guarantee while
 * every other one kept it, and nothing would fail. Hence a sweep rather than
 * a sample.
 */

let tmp: string;
let client: Client;
let operations: string[];

const NO_SCHEMA_FALLBACK = "Schema is not representable as JSON Schema";

interface SchemaHelp {
  operation?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown> };
}

/** Every JSON block in a tool result, parsed; non-JSON content is ignored. */
function jsonBlocks(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown>[] {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  const out: Record<string, unknown>[] = [];
  for (const block of content) {
    if (block.type !== "text" || !block.text) continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (parsed && typeof parsed === "object") out.push(parsed as Record<string, unknown>);
    } catch {
      // Prose content is legitimate elsewhere in a result; only the JSON matters.
    }
  }
  return out;
}

const call = (operation: string, args: Record<string, unknown>) =>
  client.callTool({ name: "call_velloo", arguments: { operation, arguments: args } });

beforeAll(async () => {
  tmp = join(tmpdir(), `velloo-corrective-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const writeJson = (p: string, v: unknown) =>
    writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
  for (const dir of [".design", "theme", "screens", "snippets", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeJson(join(tmp, ".design/config.json"), designConfig());
  await writeJson(join(tmp, "theme/default.json"), designTheme());
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Box", props: {}, children: [] },
  });

  const provider = createShadcnProvider();
  const folder = await loadDesignFolder(tmp);
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };

  const mcp = new McpServer({ name: "velloo", version: "0.1.0" });
  // Production order: the surface gate wraps registration, then the policy.
  const surface = applyMcpToolSurface(mcp, { mode: "guided" });
  applyToolPolicy(mcp);
  const stub = <T>(): T => ({}) as T;
  registerDiscoveryTools(mcp, ctx);
  registerComposeTool(mcp, ctx, stub());
  registerMutationTools(mcp, ctx, stub());
  registerInspectTool(mcp, ctx, stub(), stub(), stub());
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx, stub());
  registerScreenshotTool(mcp, ctx, stub(), stub(), stub());
  registerExtensionTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx, stub());
  registerCaptureTools(mcp, ctx);
  registerCommentTools(mcp, stub());
  registerFeedbackTool(mcp, ctx, { url: "https://cloud.invalid" });
  registerGenerateTools(mcp, ctx, { url: "https://cloud.invalid" });
  surface.finish();
  operations = [...surface.nativeTools().keys()];

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "corrective-schema-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("every operation can describe itself", () => {
  test("the sweep actually has a surface to sweep", () => {
    // A registration that silently stopped happening would otherwise turn each
    // test below into a vacuous pass over an empty list.
    expect(operations.length).toBeGreaterThan(40);
  });

  test("operation_schema returns a real schema for every operation", async () => {
    const broken: string[] = [];
    for (const operation of operations) {
      const result = await client.callTool({
        name: "operation_schema",
        arguments: { operation },
      });
      const help = jsonBlocks(result)[0] as SchemaHelp | undefined;
      const schema = help?.inputSchema;
      const usable =
        result.isError !== true &&
        help?.operation === operation &&
        schema?.type === "object" &&
        typeof schema.properties === "object" &&
        !JSON.stringify(schema).includes(NO_SCHEMA_FALLBACK);
      if (!usable) broken.push(operation);
    }
    expect(broken).toEqual([]);
  });
});

describe("a mis-shaped call carries its correction", () => {
  test("every operation with a typed required argument rejects with its own schema", async () => {
    const missing: string[] = [];
    let swept = 0;
    for (const operation of operations) {
      const described = await client.callTool({
        name: "operation_schema",
        arguments: { operation },
      });
      const schema = (jsonBlocks(described)[0] as SchemaHelp | undefined)?.inputSchema as
        | { properties?: Record<string, { type?: string }>; required?: string[] }
        | undefined;
      const required = schema?.required ?? [];
      // Drive the failure through a required property with a declared scalar
      // type: passing an object where a string belongs cannot be coerced, so
      // the operation's own schema — not the façade's — is what rejects it.
      const target = required.find((key) =>
        ["string", "number", "boolean"].includes(schema?.properties?.[key]?.type ?? ""),
      );
      if (!target) continue;
      swept++;

      const result = await call(operation, { [target]: { wrong: "type" } });
      const blocks = jsonBlocks(result);
      const help = blocks.find(
        (b) => b.kind === "InvalidOperationArguments" || b.kind === "OperationSchemaHelp",
      ) as (SchemaHelp & { kind?: string; issues?: unknown[] }) | undefined;
      const ok =
        result.isError === true &&
        help?.operation === operation &&
        help.inputSchema?.type === "object" &&
        Object.keys(help.inputSchema.properties ?? {}).includes(target);
      if (!ok) missing.push(operation);
    }
    expect(missing).toEqual([]);
    // Guards the sweep itself: a schema change that stopped marking arguments
    // required would quietly reduce this to nothing and still pass.
    expect(swept).toBeGreaterThan(25);
  });

  test("the rejection says which argument was wrong, not just that something was", async () => {
    const result = await call("update_props", { screenId: 5 });
    const help = jsonBlocks(result).find((b) => b.kind === "InvalidOperationArguments") as
      | { issues?: { path?: unknown[] }[] }
      | undefined;
    expect(help?.issues?.length).toBeGreaterThan(0);
    expect(help?.issues?.some((i) => (i.path ?? []).includes("screenId"))).toBe(true);
  });

  test("an unknown operation is refused with the operations that do exist", async () => {
    const result = await call("no_such_operation", {});
    expect(result.isError).toBe(true);
    // `operation` is an enum, so an unknown name never reaches a handler: the
    // façade's own schema rejects it and the enum *is* the correction.
    const text = ((result.content ?? []) as { text?: string }[]).map((c) => c.text).join(" ");
    expect(text).toContain("update_props");
  });
});

describe("a handler-level failure carries the schema too", () => {
  test("a well-formed call that fails inside the tool still gets corrected", async () => {
    // Shaped correctly, so the façade's own validation passes and the failure
    // comes from the handler — the other half of the guarantee.
    const result = await call("inspect", { screenId: "no-such-screen", path: [] });
    expect(result.isError).toBe(true);
    const help = jsonBlocks(result).find((b) => b.kind === "OperationSchemaHelp") as
      | SchemaHelp
      | undefined;
    expect(help?.operation).toBe("inspect");
    expect(Object.keys(help?.inputSchema?.properties ?? {})).toContain("screenId");
  });
});
