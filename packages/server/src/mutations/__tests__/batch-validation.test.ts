import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isComponentNode, type Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { BATCH_TOOLS, runBatch } from "../batch.ts";
import type { MutationContext } from "../index.ts";

/**
 * `batch` used to dispatch raw args straight into the mutation impls — its
 * table was typed `args: never` and every entry cast with `as never`, so any
 * object at all reached an impl and malformed input surfaced as a thrown
 * TypeError deep inside one. Each entry now carries the same
 * `@velloo/protocol` schema its HTTP route and MCP tool use.
 *
 * These cover the properties that guarantees: malformed args are refused as a
 * typed BadRequest, the refusal happens before anything on disk is touched,
 * and the tolerances the standalone tools offer still apply.
 */

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 3,
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
  tmp = join(tmpdir(), `velloo-batchval-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

/** Root children of a screen, narrowed past the Node union. */
function childrenOf(screenId: string) {
  const tree = folder.screens.get(screenId)?.tree;
  return tree && isComponentNode(tree) ? (tree.children ?? []) : [];
}

function errorOf(result: Awaited<ReturnType<typeof runBatch>>): Record<string, unknown> {
  const failing = result.results.find((r) => !r.ok);
  expect(failing).toBeDefined();
  return (failing?.error ?? {}) as Record<string, unknown>;
}

describe("batch argument validation", () => {
  test("every batch tool validates through a schema", () => {
    for (const [name, tool] of Object.entries(BATCH_TOOLS)) {
      const prepared = tool.prepare({ nonsense: true });
      expect(prepared.ok, `${name} accepted junk args`).toBe(false);
    }
  });

  test("update_props without propPatch is a BadRequest, not a thrown TypeError", async () => {
    // The exact shape that once reached `Object.entries` and crashed.
    const result = await runBatch(ctx, [
      { tool: "update_props", args: { screenId: "landing", path: [] } },
    ]);
    expect(result.rolledBack).toBe(true);
    expect(errorOf(result).kind).toBe("BadRequest");
  });

  test("a missing required field is refused before the folder is touched", async () => {
    const before = JSON.stringify(folder.screens.get("landing"));
    const result = await runBatch(ctx, [
      // `componentRef` is required; nothing should be snapshotted or written.
      { tool: "add_node", args: { screenId: "landing", parentPath: [] } },
    ]);
    expect(result.rolledBack).toBe(true);
    expect(errorOf(result).kind).toBe("BadRequest");
    expect(JSON.stringify(folder.screens.get("landing"))).toBe(before);
    expect(events).toHaveLength(0);
  });

  test("a wrong-typed field is refused with the offending path in issues", async () => {
    const result = await runBatch(ctx, [
      { tool: "add_frame", args: { boardId: "b", screenId: "landing", w: "wide", h: 900 } },
    ]);
    const error = errorOf(result);
    expect(error.kind).toBe("BadRequest");
    expect(JSON.stringify(error.issues)).toContain("w");
  });

  test("an unsupported tool name is a typed BadRequest", async () => {
    const result = await runBatch(ctx, [{ tool: "drop_database", args: {} }]);
    expect(errorOf(result).kind).toBe("BadRequest");
  });

  test("a later malformed call rolls the earlier successful one back", async () => {
    const result = await runBatch(ctx, [
      { tool: "add_node", args: { screenId: "landing", parentPath: [], componentRef: "Button" } },
      { tool: "update_props", args: { screenId: "landing" } },
    ]);
    expect(result.rolledBack).toBe(true);
    expect(result.completed).toBe(1);
    // The first call's insert must not survive the rollback.
    expect(childrenOf("landing")).toHaveLength(0);
  });
});

describe("batch keeps the standalone tools' tolerances", () => {
  test("a JSON-stringified children array is parsed, not rejected", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: {
          screenId: "landing",
          parentPath: [],
          componentRef: "Card",
          children: JSON.stringify([{ $ref: "Button", props: { children: "Save" } }]),
        },
      },
    ]);
    expect(result.rolledBack).toBe(false);
    expect(result.completed).toBe(1);
  });

  test("`propPatch` works as an alias for add_node's `props`", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: {
          screenId: "landing",
          parentPath: [],
          componentRef: "Button",
          propPatch: { children: "Save" },
        },
      },
    ]);
    expect(result.rolledBack).toBe(false);
    expect(childrenOf("landing")[0]).toMatchObject({
      $ref: "Button",
      props: { children: "Save" },
    });
  });

  test("update_snippet_instance rejects a call that names neither side", async () => {
    const prepared = BATCH_TOOLS.update_snippet_instance?.prepare({
      screenId: "landing",
      path: [0],
    });
    expect(prepared?.ok).toBe(false);
  });

  test("update_snippet_instance takes the arg side alone", async () => {
    const prepared = BATCH_TOOLS.update_snippet_instance?.prepare({
      screenId: "landing",
      path: [0],
      argPatch: { title: "Hi" },
    });
    expect(prepared?.ok).toBe(true);
  });

  test("update_snippet_instance refuses a half-specified override", async () => {
    const prepared = BATCH_TOOLS.update_snippet_instance?.prepare({
      screenId: "landing",
      path: [0],
      innerPath: "@badge",
    });
    expect(prepared?.ok).toBe(false);
  });

  test("update_props accepts the bulk `patches` form", async () => {
    const prepared = BATCH_TOOLS.update_props?.prepare({
      screenId: "landing",
      patches: [{ path: [], propPatch: { className: "p-8" } }],
    });
    expect(prepared?.ok).toBe(true);
  });

  test("a locator passed as a JSON string still resolves", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "update_props",
        args: { screenId: "landing", path: "[]", propPatch: { className: "p-8" } },
      },
    ]);
    expect(result.rolledBack).toBe(false);
    const tree = folder.screens.get("landing")?.tree;
    expect(tree && isComponentNode(tree) ? tree.props?.className : undefined).toBe("p-8");
  });
});
