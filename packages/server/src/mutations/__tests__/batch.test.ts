import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { designConfig, designTheme } from "../../testing/design-folder.ts";

import type { WatchEvent } from "../../watcher.ts";
import { runBatch } from "../batch.ts";
import type { MutationContext } from "../index.ts";

const provider = createShadcnProvider();

const sampleConfig = designConfig();

const sampleTheme = designTheme({
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
});

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

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

  test("snippet edits run inside a batch", async () => {
    await mkdir(join(tmp, "snippets"), { recursive: true });
    const result = await runBatch(ctx, [
      {
        tool: "add_snippet",
        args: {
          id: "row",
          name: "Row",
          params: [],
          tree: { $ref: "Box", props: { className: "p-1" } },
        },
      },
      {
        tool: "update_snippet",
        args: { snippetId: "row", patch: { tree: { $ref: "Box", props: { className: "p-2" } } } },
      },
    ]);
    expect(result.completed).toBe(2);
    expect(result.rolledBack).toBe(false);
    const tree = folder.snippets.get("row")?.tree as unknown as { props: { className: string } };
    expect(tree.props.className).toBe("p-2");
  });

  test("add_snippet inside a batch defaults params when omitted", async () => {
    await mkdir(join(tmp, "snippets"), { recursive: true });
    // batch dispatches raw args (no Zod `.default([])`), so the mutation itself
    // must default params — otherwise a params-less add_snippet would throw.
    const result = await runBatch(ctx, [
      {
        tool: "add_snippet",
        args: { id: "bare", name: "Bare", tree: { $ref: "Box", props: { className: "p-1" } } },
      },
    ]);
    expect(result.completed).toBe(1);
    expect(result.rolledBack).toBe(false);
    expect(folder.snippets.get("bare")?.params).toEqual([]);
  });

  test("rollback restores a snippet edited earlier in the batch", async () => {
    await mkdir(join(tmp, "snippets"), { recursive: true });
    await runBatch(ctx, [
      {
        tool: "add_snippet",
        args: {
          id: "card",
          name: "Card",
          params: [],
          tree: { $ref: "Box", props: { className: "a" } },
        },
      },
    ]);
    const before = JSON.stringify(folder.snippets.get("card"));

    const result = await runBatch(ctx, [
      {
        tool: "update_snippet",
        args: { snippetId: "card", patch: { tree: { $ref: "Box", props: { className: "b" } } } },
      },
      // Fails: unknown screen — should roll the snippet edit back.
      { tool: "add_node", args: { screenId: "ghost", parentPath: [], componentRef: "Badge" } },
    ]);

    expect(result.rolledBack).toBe(true);
    expect(JSON.stringify(folder.snippets.get("card"))).toBe(before);
    const onDisk = await Bun.file(join(tmp, "snippets", "card.json")).text();
    expect(JSON.stringify(JSON.parse(onDisk))).toBe(before);
  });

  test("remove_frame inside a batch drops the placement, leaves the screen", async () => {
    const setup = await runBatch(ctx, [
      { tool: "add_board", args: { id: "b1", name: "Board" } },
      { tool: "add_frame", args: { boardId: "b1", screenId: "landing", w: 800, h: 600, id: "f1" } },
    ]);
    expect(setup.completed).toBe(2);

    const result = await runBatch(ctx, [
      { tool: "remove_frame", args: { boardId: "b1", frameId: "f1" } },
    ]);
    expect(result.completed).toBe(1);
    expect(result.rolledBack).toBe(false);
    expect(folder.boards.get("b1")?.frames.length).toBe(0);
    expect(folder.screens.has("landing")).toBe(true);
  });

  test("remove_screen inside a batch cascades frame removal", async () => {
    const setup = await runBatch(ctx, [
      { tool: "add_screen", args: { id: "promo", name: "Promo", tree: { $ref: "Card" } } },
      { tool: "add_board", args: { id: "b1", name: "Board" } },
      { tool: "add_frame", args: { boardId: "b1", screenId: "promo", w: 800, h: 600, id: "pf" } },
    ]);
    expect(setup.completed).toBe(3);

    const result = await runBatch(ctx, [{ tool: "remove_screen", args: { screenId: "promo" } }]);
    expect(result.completed).toBe(1);
    expect(result.rolledBack).toBe(false);
    expect(folder.screens.has("promo")).toBe(false);
    expect(await Bun.file(join(tmp, "screens", "promo.json")).exists()).toBe(false);
    // Cascade: the frame placing the removed screen is gone from the board.
    expect(folder.boards.get("b1")?.frames.some((f) => f.id === "pf")).toBe(false);
  });

  test("rollback restores a removed screen, its cascaded frames, and annotations", async () => {
    const setup = await runBatch(ctx, [
      { tool: "add_screen", args: { id: "promo", name: "Promo", tree: { $ref: "Card" } } },
      { tool: "add_board", args: { id: "b1", name: "Board" } },
      { tool: "add_frame", args: { boardId: "b1", screenId: "promo", w: 800, h: 600, id: "pf" } },
    ]);
    expect(setup.completed).toBe(3);

    // Seed an annotation sidecar on the screen we'll remove.
    const annotation = {
      id: "a1",
      target: { locator: [] },
      position: "auto" as const,
      body: "hi",
      author: "user" as const,
    };
    folder.annotations.set("promo", [annotation]);
    await writeJson(join(tmp, "screens", "promo.annotations.json"), [annotation]);

    const screenBefore = JSON.stringify(folder.screens.get("promo"));
    const boardBefore = JSON.stringify(folder.boards.get("b1"));

    const result = await runBatch(ctx, [
      { tool: "remove_screen", args: { screenId: "promo" } },
      // Fails: unknown screen — the whole remove (screen + cascade) must roll back.
      { tool: "add_node", args: { screenId: "ghost", parentPath: [], componentRef: "Badge" } },
    ]);

    expect(result.rolledBack).toBe(true);
    // Screen restored in memory + on disk.
    expect(JSON.stringify(folder.screens.get("promo"))).toBe(screenBefore);
    expect(await Bun.file(join(tmp, "screens", "promo.json")).exists()).toBe(true);
    // Cascaded frame restored on the board.
    expect(JSON.stringify(folder.boards.get("b1"))).toBe(boardBefore);
    // Annotations sidecar restored in memory + on disk.
    expect(folder.annotations.get("promo")).toEqual([annotation]);
    expect(await Bun.file(join(tmp, "screens", "promo.annotations.json")).exists()).toBe(true);
  });

  test("add_node in a batch rejects the removed `propPatch` alias", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: { screenId: "landing", componentRef: "Box", propPatch: { className: "p-4" } },
      },
    ]);
    // `props` is add_node's only name for this now — it sets initial props
    // rather than patching, so the patch-shaped alias was also a misnomer.
    expect(result.results[0]?.ok).toBe(false);
  });

  test("update_props in a batch rejects the removed `props` alias", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "update_props",
        args: { screenId: "landing", patches: [{ path: [], props: { className: "p-4" } }] },
      },
    ]);
    expect(result.results[0]?.ok).toBe(false);
  });
});
