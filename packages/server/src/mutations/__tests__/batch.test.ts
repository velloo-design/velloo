import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { runBatch } from "../batch.ts";
import type { MutationContext } from "../index.ts";

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
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
let events: WatchEvent[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
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
    provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("runBatch", () => {
  test("success: applies all calls, flushes broadcasts once at the end", async () => {
    const result = await runBatch(ctx, [
      { tool: "add_screen", args: { id: "promo", name: "Promo", tree: { $ref: "Card" } } },
      { tool: "add_board", args: { id: "b1", name: "Board" } },
      { tool: "add_frame", args: { boardId: "b1", screenId: "promo", w: 800, h: 600 } },
      {
        tool: "add_node",
        args: { screenId: "landing", parentPath: [], componentRef: "Badge", id: "tag" },
      },
    ]);
    expect(result.completed).toBe(4);
    expect(result.rolledBack).toBe(false);
    expect(folder.screens.has("promo")).toBe(true);
    expect(folder.boards.get("b1")?.frames.length).toBe(1);
    expect(await Bun.file(join(tmp, "screens", "promo.json")).exists()).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  test("failure: rolls back created resources, edits, history, and emits no broadcasts", async () => {
    const landingBefore = JSON.stringify(folder.screens.get("landing"));
    const undoBefore = folder.history.depths().undo;

    const result = await runBatch(ctx, [
      { tool: "add_screen", args: { id: "promo", name: "Promo", tree: { $ref: "Card" } } },
      {
        tool: "add_node",
        args: { screenId: "landing", parentPath: [], componentRef: "Badge", id: "tag" },
      },
      // Fails: unknown screen.
      { tool: "add_node", args: { screenId: "ghost", parentPath: [], componentRef: "Badge" } },
      { tool: "add_board", args: { id: "never", name: "Never" } },
    ]);

    expect(result.rolledBack).toBe(true);
    expect(result.completed).toBe(2);
    expect(result.results[2]?.ok).toBe(false);
    // Created screen gone from memory + disk.
    expect(folder.screens.has("promo")).toBe(false);
    expect(await Bun.file(join(tmp, "screens", "promo.json")).exists()).toBe(false);
    // Edited screen restored byte-for-byte in memory and on disk.
    expect(JSON.stringify(folder.screens.get("landing"))).toBe(landingBefore);
    const onDisk = JSON.parse(await Bun.file(join(tmp, "screens", "landing.json")).text());
    expect(JSON.stringify(onDisk.tree)).toBe(JSON.stringify(folder.screens.get("landing")?.tree));
    // Fourth call never ran.
    expect(folder.boards.has("never")).toBe(false);
    // No mutation-layer broadcasts escaped; undo unwound.
    expect(events).toEqual([]);
    expect(folder.history.depths().undo).toBe(undoBefore);
  });

  test("atomic: false keeps completed work on failure", async () => {
    const result = await runBatch(
      ctx,
      [
        { tool: "add_screen", args: { id: "kept", name: "Kept", tree: { $ref: "Card" } } },
        { tool: "add_node", args: { screenId: "ghost", parentPath: [], componentRef: "Badge" } },
      ],
      { atomic: false },
    );
    expect(result.rolledBack).toBe(false);
    expect(result.completed).toBe(1);
    expect(folder.screens.has("kept")).toBe(true);
  });
});
