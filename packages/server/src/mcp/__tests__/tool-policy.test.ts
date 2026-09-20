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
import { applyToolPolicy, TOOL_ANNOTATIONS } from "../tool-policy.ts";
import { registerAssetTools } from "../tools/assets.ts";
import { registerBatchTool } from "../tools/batch.ts";
import { registerCaptureTools } from "../tools/captures.ts";
import { registerCommentTools } from "../tools/comments.ts";
import { registerComposeTool } from "../tools/compose.ts";
import { registerDesignTools } from "../tools/designs.ts";
import { registerDiscoveryTools } from "../tools/discovery.ts";
import { registerEmitTools } from "../tools/emit.ts";
import { registerExtensionTools } from "../tools/extensions.ts";
import { registerFeedbackTool } from "../tools/feedback.ts";
import { registerGenerateTools } from "../tools/generate.ts";
import { registerInspectTool } from "../tools/inspect.ts";
import { registerMutationTools } from "../tools/mutations.ts";
import { registerNoteTools } from "../tools/notes.ts";
import { registerRepoTools } from "../tools/repo.ts";
import { registerScreenshotTool } from "../tools/screenshot.ts";
import { registerThemeTools } from "../tools/theme.ts";

/**
 * The guard the deleted tool-family table never had. That table went on naming
 * three tools that had been removed a release earlier, because the only check
 * for it sat behind a disabled flag — so this one runs against the real
 * registration path and fails in both directions: a tool registered without a
 * classification, and a classification for a tool that no longer exists.
 *
 * It also holds the surface's error charter: an error is `isError` plus a
 * JSON `{ kind }`, never prose and never an ordinary-looking result.
 */

let tmp: string;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
let client: Client;

/**
 * Render/capture tools drive a real browser, and the cloud tools would reach
 * the network — neither belongs in the failure sweep below. Their error paths
 * are all `errorResult`, which is what the charter is about.
 */
const NO_INVOKE = new Set([
  "screenshot",
  "compare_to_url",
  "render_snippet",
  "start_capture_session",
  "generate_asset",
  "send_feedback",
  "emit_theme",
]);

beforeAll(async () => {
  tmp = join(tmpdir(), `velloo-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  const writeJson = (p: string, v: unknown) =>
    writeFile(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
  await writeJson(join(tmp, ".design/config.json"), {
    schemaVersion: 4,
    name: "test",
    toolVersion: "0.1.0",
    libraries: {
      default: {
        id: "shadcn-upstream",
        version: "test",
        source: "binary",
        componentsPath: "binary",
      },
    },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
  });
  await writeJson(join(tmp, "theme/default.json"), {
    name: "default",
    colors: {
      background: "#fff",
      foreground: "#000",
      primary: { DEFAULT: "#000", foreground: "#fff" },
    },
    typography: {},
    spacing: {},
    radius: {},
  });
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
  applyToolPolicy(mcp);
  // No handler under test needs these; the sweep skips the tools that do.
  const stub = <T>(): T => ({}) as T;
  registerDiscoveryTools(mcp, ctx);
  registerComposeTool(mcp, ctx);
  registerMutationTools(mcp, ctx);
  registerInspectTool(mcp, ctx, stub(), stub(), stub());
  registerThemeTools(mcp, ctx);
  registerEmitTools(mcp, ctx);
  registerScreenshotTool(mcp, ctx, stub(), stub(), stub());
  registerRepoTools(mcp, ctx, stub(), stub(), stub());
  registerExtensionTools(mcp, ctx);
  registerNoteTools(mcp, ctx);
  registerAssetTools(mcp, ctx);
  registerBatchTool(mcp, ctx);
  registerCaptureTools(mcp, ctx);
  registerCommentTools(mcp, stub());
  registerFeedbackTool(mcp, ctx, { url: "https://cloud.invalid" });
  registerGenerateTools(mcp, ctx, { url: "https://cloud.invalid" });
  // Registered only in a multi-design session; the table still has to name them.
  registerDesignTools(mcp, ctx, {
    current: "test",
    names: ["other", "test"],
    switchable: true,
    pick: undefined,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "policy-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("tool annotations", () => {
  test("every registered tool carries behavioural annotations", () => {
    const missing = tools.filter((t) => t.annotations === undefined).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  test("the table names exactly the registered tools — no strays, no gaps", () => {
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(tools.map((t) => t.name).sort());
    expect(tools.map((tool) => tool.name)).not.toContain("install_component");
  });

  test("read-only tools are the ones that cannot change the folder", () => {
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    // A tool whose name starts with a mutating verb claiming readOnly would let
    // a host auto-approve a write.
    const mutatingVerb =
      /^(add|update|remove|set|move|import|upload|install|reorder|instantiate|generate|send|start|batch)/;
    expect(readOnly.filter((n) => mutatingVerb.test(n))).toEqual([]);
    expect(readOnly.length).toBeGreaterThan(18);
  });

  test("a destructive tool never also claims to be read-only", () => {
    const contradictory = tools
      .filter(
        (t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true,
      )
      .map((t) => t.name);
    expect(contradictory).toEqual([]);
  });
});

describe("output schemas", () => {
  test("only the tools an agent branches on declare one", () => {
    const declared = tools
      .filter((t) => t.outputSchema !== undefined)
      .map((t) => t.name)
      .sort();
    expect(declared).toEqual(["compare_to_url", "emit_code", "find_nodes", "list_components"]);
  });

  test("a declared tool returns structuredContent that validates", async () => {
    const result = await client.callTool({
      name: "find_nodes",
      arguments: { screenId: "landing" },
    });
    // The SDK throws on a declared tool that omits or fails its output schema,
    // so reaching here at all is the assertion; the shape check is the detail.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ total: expect.any(Number) });

    const components = await client.callTool({
      name: "list_components",
      arguments: { mode: "summary" },
    });
    expect(components.isError).toBeUndefined();
    expect(components.structuredContent).toMatchObject({
      components: expect.arrayContaining([
        expect.objectContaining({
          id: "Box",
          availableInDesign: true,
          installedInApp: true,
        }),
      ]),
    });
  });
});

describe("error charter", () => {
  test("every failure is isError with a JSON { kind }", async () => {
    const bogus = "definitely-not-real";
    const failures: string[] = [];
    let checked = 0;
    for (const tool of tools) {
      if (NO_INVOKE.has(tool.name)) continue;
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      const required = (tool.inputSchema.required ?? []) as string[];
      // Only sweep tools we can drive to a failure with string ids alone —
      // anything else would fail the SDK's own arg validation, which is a
      // protocol error rather than the tool result this charter is about.
      if (required.length === 0) continue;
      const args: Record<string, unknown> = {};
      let drivable = true;
      for (const key of required) {
        const prop = props[key] as { type?: string } | undefined;
        if (prop?.type !== "string") {
          drivable = false;
          break;
        }
        args[key] = bogus;
      }
      if (!drivable) continue;

      const result = await client.callTool({ name: tool.name, arguments: args });
      if (result.isError !== true) continue; // succeeded against the bogus id — fine
      const content = result.content as { type: string; text: string }[];
      const text = content[0]?.text ?? "";
      // A JSON-RPC input-validation error is the SDK's, not the tool's: the
      // charter here is about the results tools return, and a tool never gets
      // to run when its arguments fail the schema.
      if (text.startsWith("MCP error -32602")) continue;
      checked += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        failures.push(`${tool.name}: error text is not JSON (${text.slice(0, 60)})`);
        continue;
      }
      if (typeof (parsed as { kind?: unknown })?.kind !== "string") {
        failures.push(`${tool.name}: error JSON has no string \`kind\``);
      }
    }
    expect(failures).toEqual([]);
    // Guards the sweep itself: a schema change that made every tool
    // un-drivable would otherwise leave this test passing vacuously.
    expect(checked).toBeGreaterThan(15);
  });

  test("send_feedback reports being signed out as an error, not an ok result", async () => {
    const result = await client.callTool({
      name: "send_feedback",
      arguments: { body: "the style pane confused me" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    const error = JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(error.kind).toBe("FeedbackNotSent");
    expect(error.reason).toBe("signed-out");
    expect(error.retryable).toBe(false);
  });
});
