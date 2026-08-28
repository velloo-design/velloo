import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import { runBatch } from "../../../mutations/batch.ts";
import { badRequest, scalarChildrenHint } from "../../../mutations/errors.ts";
import type { MutationContext } from "../../../mutations/index.ts";
import { AddNodeBody } from "../../../routes/mutate-schemas.ts";
import type { WatchEvent } from "../../../watcher.ts";
import { registerMutationTools } from "../mutations.ts";

/**
 * Guards the "did you mean props.children?" nudge for the scalar-as-children
 * footgun across the three surfaces where the failure is ours to shape: the
 * detector itself, the standalone `add_node` MCP tool, and the `batch` path
 * (which skips MCP arg validation and so trips the persist-time schema parse).
 */

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 2,
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
};

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-hint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
  });
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

type McpToolResult = { isError?: true; content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpToolResult>;

/**
 * Reach the registered tool's handler and invoke it directly. This skips the
 * SDK's own arg validation, which is fine here: the scalar-`children` nudge is
 * the *handler's* job (the input schema is deliberately permissive enough to
 * let the scalar through to it).
 */
function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerMutationTools(mcp, ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

function parseError(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("scalarChildrenHint detector", () => {
  test("matches an invalid_type expected-array issue at a children path", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "array", path: ["tree", "children"] },
    ]);
    expect(hint).toBeDefined();
    expect(hint).toContain("props.children");
  });

  test("does not match unrelated array errors (different path)", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "array", path: ["patches"] },
    ]);
    expect(hint).toBeUndefined();
  });

  test("does not match a non-array invalid_type at children (e.g. expected string)", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "string", path: ["children"] },
    ]);
    expect(hint).toBeUndefined();
  });

  test("badRequest attaches the hint when issues carry the scalar-children shape", () => {
    const e = badRequest("Request body failed validation.", [
      { code: "invalid_type", expected: "array", path: ["children"] },
    ]);
    expect(e.kind).toBe("BadRequest");
    if (e.kind === "BadRequest") {
      expect(e.hint).toContain("props.children");
    }
  });

  test("badRequest stays hint-free for an unrelated validation error", () => {
    const e = badRequest("Request body failed validation.", [
      { code: "invalid_type", expected: "string", path: ["screenId"] },
    ]);
    if (e.kind === "BadRequest") {
      expect(e.hint).toBeUndefined();
      // No-hint case must serialize without a `hint` key.
      expect(JSON.parse(JSON.stringify(e))).not.toHaveProperty("hint");
    }
  });
});

describe("add_node MCP tool", () => {
  test('children: "Save" returns a BadRequest whose hint mentions props.children', async () => {
    const result = await callTool("add_node", {
      screenId: "landing",
      parentPath: [],
      componentRef: "Button",
      children: "Save",
    });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.kind).toBe("BadRequest");
    expect(error.hint).toContain("props.children");
  });

  test("a valid children: [...] array succeeds", async () => {
    const result = await callTool("add_node", {
      screenId: "landing",
      parentPath: [],
      componentRef: "Card",
      children: [{ $ref: "Button", props: { children: "Save" } }],
    });
    expect(result.isError).toBeUndefined();
  });

  test("a valid props.children scalar succeeds", async () => {
    const result = await callTool("add_node", {
      screenId: "landing",
      parentPath: [],
      componentRef: "Button",
      props: { children: "Save" },
    });
    expect(result.isError).toBeUndefined();
  });

  test("an unrelated error (unknown component) gets no children hint", async () => {
    const result = await callTool("add_node", {
      screenId: "landing",
      parentPath: [],
      componentRef: "Definitely-Not-Real",
    });
    expect(result.isError).toBe(true);
    const error = parseError(result);
    expect(error.kind).toBe("UnknownComponent");
    expect(error.hint).toBeUndefined();
  });
});

describe("batch path", () => {
  test('add_node with children: "Save" rolls back with a hinted BadRequest', async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: { screenId: "landing", parentPath: [], componentRef: "Button", children: "Save" },
      },
    ]);
    expect(result.rolledBack).toBe(true);
    const failing = result.results.find((r) => !r.ok);
    expect(failing).toBeDefined();
    const error = failing?.error as Record<string, unknown>;
    expect(error.kind).toBe("BadRequest");
    expect(error.hint).toContain("props.children");
  });

  test("a valid batch add_node succeeds and carries no hint", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: {
          screenId: "landing",
          parentPath: [],
          componentRef: "Card",
          children: [{ $ref: "Button", props: { children: "Save" } }],
        },
      },
    ]);
    expect(result.rolledBack).toBe(false);
    expect(result.completed).toBe(1);
  });
});

describe("HTTP route body validation", () => {
  test("a scalar children body yields the hint through badRequest(issues)", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "landing",
      parentPath: [],
      componentRef: "Button",
      children: "Save",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const error = badRequest("Request body failed validation.", parsed.error.issues);
    if (error.kind === "BadRequest") expect(error.hint).toContain("props.children");
  });

  test("a valid children array body passes validation", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "landing",
      parentPath: [],
      componentRef: "Card",
      children: [{ $ref: "Button" }],
    });
    expect(parsed.success).toBe(true);
  });

  test("an unrelated body failure carries no children hint", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "",
      parentPath: [],
      componentRef: "Button",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const error = badRequest("Request body failed validation.", parsed.error.issues);
    if (error.kind === "BadRequest") expect(error.hint).toBeUndefined();
  });
});
