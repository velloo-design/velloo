import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isComponentNode, type Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { runBatch } from "../batch.ts";
import type { MutationContext } from "../index.ts";
import { removeNode, setScreenTree } from "../index.ts";

/**
 * The rebuild-a-placeholder affordances (2026-07-11 trace findings):
 *  - remove_node with a root locator clears the root's children instead of erroring
 *  - set_screen_tree replaces the whole tree in one call, keeping screen identity
 *  - update_snippet_instance is batchable and rolls back with the batch
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

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-sst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: {
      $ref: "Card",
      props: { className: "p-4" },
      children: [
        { $ref: "Heading", props: { level: 1, children: "Old" } },
        { $snippet: "stat-card", args: { title: "Visits" } },
      ],
    },
  });
  await writeJson(join(tmp, "snippets/stat-card.json"), {
    id: "stat-card",
    name: "Stat Card",
    params: [{ name: "title", type: "string" }],
    tree: { $ref: "Card", props: { className: "p-2" } },
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

describe("remove_node root locator", () => {
  test("clears the root's children instead of erroring", async () => {
    const res = await removeNode(ctx, { screenId: "landing", path: [] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.removedRef).toContain("cleared 2 child nodes");
    const tree = folder.screens.get("landing")?.tree;
    expect(tree && isComponentNode(tree) ? tree.children : "kept").toBeUndefined();
    expect(tree && isComponentNode(tree) ? tree.$ref : "").toBe("Card");
  });
});

describe("set_screen_tree", () => {
  test("replaces the whole tree, keeping screen identity", async () => {
    const res = await setScreenTree(ctx, {
      screenId: "landing",
      tree: { $ref: "Box", props: { className: "grid" }, children: [{ $ref: "Button" }] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.replacedRootRef).toBe("Card");
    const screen = folder.screens.get("landing");
    expect(screen?.name).toBe("Landing");
    expect(screen && isComponentNode(screen.tree) ? screen.tree.$ref : "").toBe("Box");
  });

  test("unknown screen fails with ScreenNotFound", async () => {
    const res = await setScreenTree(ctx, { screenId: "nope", tree: { $ref: "Box" } });
    expect(res.ok).toBe(false);
  });
});

describe("batch integration", () => {
  test("update_snippet_instance inside a batch patches instance args", async () => {
    const res = await runBatch(ctx, [
      {
        tool: "update_snippet_instance",
        args: { screenId: "landing", path: [1], argPatch: { title: "Revenue" } },
      },
    ]);
    expect(res.completed).toBe(1);
    expect(res.rolledBack).toBe(false);
    const tree = folder.screens.get("landing")?.tree;
    const inst =
      tree && isComponentNode(tree)
        ? (tree.children?.[1] as { args?: { title?: string } })
        : undefined;
    expect(inst?.args?.title).toBe("Revenue");
  });

  test("a failing batch rolls update_snippet_instance back", async () => {
    const res = await runBatch(ctx, [
      {
        tool: "update_snippet_instance",
        args: { screenId: "landing", path: [1], argPatch: { title: "Revenue" } },
      },
      { tool: "remove_node", args: { screenId: "landing", path: [99] } },
    ]);
    expect(res.rolledBack).toBe(true);
    const tree = folder.screens.get("landing")?.tree;
    const inst =
      tree && isComponentNode(tree)
        ? (tree.children?.[1] as { args?: { title?: string } })
        : undefined;
    expect(inst?.args?.title).toBe("Visits");
  });

  test("set_screen_tree is batchable", async () => {
    const res = await runBatch(ctx, [
      { tool: "set_screen_tree", args: { screenId: "landing", tree: { $ref: "Box" } } },
    ]);
    expect(res.completed).toBe(1);
    expect(res.rolledBack).toBe(false);
    const tree = folder.screens.get("landing")?.tree;
    expect(tree && isComponentNode(tree) ? tree.$ref : "").toBe("Box");
  });
});
