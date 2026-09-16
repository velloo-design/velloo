import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { Hono } from "hono";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { createUndoRouter } from "../../routes/undo.ts";
import { type MutationContext, moveFrame } from "../index.ts";

const sampleConfig = {
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
};

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const provider = createShadcnProvider();
let root: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: Array<{ type: string; boardId?: string }>;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  root = join(tmpdir(), `velloo-move-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(root, ".design"), { recursive: true });
  await mkdir(join(root, "theme"), { recursive: true });
  await mkdir(join(root, "boards"), { recursive: true });
  await writeJson(join(root, ".design/config.json"), sampleConfig);
  await writeJson(join(root, "theme/default.json"), sampleTheme);
  await writeJson(join(root, "boards/main.json"), {
    id: "main",
    name: "Main",
    frames: [
      {
        id: "home",
        screen: "home",
        x: 0,
        y: 0,
        w: 1440,
        h: 900,
        label: "Landing",
        scheme: "dark",
        group: "hero",
      },
    ],
    groups: [{ id: "hero", name: "Hero" }],
  });
  await writeJson(join(root, "boards/scratch.json"), {
    id: "scratch",
    name: "Scratch",
    frames: [{ id: "about", screen: "about", x: 0, y: 0, w: 800, h: 600 }],
    groups: [],
  });
  folder = await loadDesignFolder(root);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => {
      events.push(e as { type: string; boardId?: string });
    },
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("move_frame", () => {
  test("re-files the placement, auto-placing it on the target board", async () => {
    const r = await moveFrame(ctx, { boardId: "main", frameId: "home", toBoardId: "scratch" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(folder.boards.get("main")?.frames).toHaveLength(0);
    const moved = folder.boards.get("scratch")?.frames.find((f) => f.screen === "home");
    expect(moved).toMatchObject({ id: "home", w: 1440, h: 900, label: "Landing", scheme: "dark" });
    // Right of the target's rightmost frame (800 wide at x=0), not the source x.
    expect(moved?.x).toBe(880);
    // The source board's frame region doesn't exist on the target.
    expect(moved).not.toHaveProperty("group");
    expect(r.value.frame.id).toBe("home");

    const boardEvents = events.filter((e) => e.type === "board-changed").map((e) => e.boardId);
    expect(boardEvents).toContain("main");
    expect(boardEvents).toContain("scratch");
  });

  test("honours an explicit position", async () => {
    const r = await moveFrame(ctx, {
      boardId: "main",
      frameId: "home",
      toBoardId: "scratch",
      x: 120,
      y: 40,
    });
    expect(r.ok).toBe(true);
    expect(folder.boards.get("scratch")?.frames[1]).toMatchObject({ x: 120, y: 40 });
  });

  test("renames the frame when the target board already uses its id", async () => {
    await writeJson(join(root, "boards/scratch.json"), {
      id: "scratch",
      name: "Scratch",
      frames: [{ id: "home", screen: "home", x: 0, y: 0, w: 375, h: 812 }],
      groups: [],
    });
    folder = await loadDesignFolder(root);
    ctx = { ...ctx, folder };

    const r = await moveFrame(ctx, { boardId: "main", frameId: "home", toBoardId: "scratch" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.frame.id).toBe("home-1");
    expect(folder.boards.get("scratch")?.frames.map((f) => f.id)).toEqual(["home", "home-1"]);
  });

  /**
   * The move writes two boards, and the user performed one act — so it has to
   * cost one ⌘Z. Two entries would step through "on both boards" or "on
   * neither", states nobody asked for.
   */
  test("undo takes the frame back in a single step, and redo re-applies it", async () => {
    const undoApp = new Hono().route(
      "/api/undo",
      createUndoRouter(
        () => folder,
        () => {},
      ),
    );
    const post = (path: string) =>
      undoApp.fetch(new Request(`http://localhost${path}`, { method: "POST" }));

    await moveFrame(ctx, { boardId: "main", frameId: "home", toBoardId: "scratch" });
    expect(folder.history.depths().undo).toBe(1);

    const undone = (await (await post("/api/undo")).json()) as {
      reverted: { kind: string; boardIds: string[] };
      undo: number;
      redo: number;
    };
    expect(undone.reverted).toEqual({ kind: "boards", boardIds: ["scratch", "main"] });
    expect(undone).toMatchObject({ undo: 0, redo: 1 });
    expect(folder.boards.get("main")?.frames.map((f) => f.id)).toEqual(["home"]);
    expect(folder.boards.get("scratch")?.frames.map((f) => f.id)).toEqual(["about"]);
    // On disk too, not just in the cache.
    const source = JSON.parse(await readFile(join(root, "boards/main.json"), "utf8")) as {
      frames: Array<{ id: string }>;
    };
    expect(source.frames.map((f) => f.id)).toEqual(["home"]);

    await post("/api/undo/redo");
    expect(folder.boards.get("main")?.frames).toHaveLength(0);
    expect(folder.boards.get("scratch")?.frames.map((f) => f.id)).toEqual(["about", "home"]);
    expect(folder.history.depths()).toEqual({ undo: 1, redo: 0 });
  });

  test("rejects an unknown board, an unknown frame, and a move to the same board", async () => {
    const noBoard = await moveFrame(ctx, {
      boardId: "main",
      frameId: "home",
      toBoardId: "nope",
    });
    expect(noBoard.ok).toBe(false);
    if (!noBoard.ok) expect(noBoard.error.kind).toBe("BoardNotFound");

    const noFrame = await moveFrame(ctx, {
      boardId: "main",
      frameId: "ghost",
      toBoardId: "scratch",
    });
    expect(noFrame.ok).toBe(false);
    if (!noFrame.ok) expect(noFrame.error.kind).toBe("FrameNotFound");

    const sameBoard = await moveFrame(ctx, {
      boardId: "main",
      frameId: "home",
      toBoardId: "main",
    });
    expect(sameBoard.ok).toBe(false);
    if (!sameBoard.ok) expect(sameBoard.error.kind).toBe("InvalidMove");

    // Nothing moved.
    expect(folder.boards.get("main")?.frames).toHaveLength(1);
    expect(folder.boards.get("scratch")?.frames).toHaveLength(1);
  });
});
