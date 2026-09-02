import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { MAX_BOARD_NAME_LENGTH, type Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { addBoard, type MutationContext, updateBoard } from "../index.ts";

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

const provider = createShadcnProvider();

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

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-update-board-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "boards/alpha.json"), {
    id: "alpha",
    name: "Alpha",
    frames: [],
    groups: [],
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

describe("update_board", () => {
  test("renames the board, persists, and broadcasts board-changed", async () => {
    const result = unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { name: "Flows" } }));
    expect(result.board.name).toBe("Flows");
    expect(folder.boards.get("alpha")?.name).toBe("Flows");
    expect(events.filter((e) => e.type !== "activity")).toEqual([
      { type: "board-changed", boardId: "alpha" },
    ]);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("alpha")?.name).toBe("Flows");
  });

  test("sets and clears the board theme", async () => {
    unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { theme: "dark" } }));
    expect(folder.boards.get("alpha")?.theme).toBe("dark");
    const cleared = unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { theme: null } }));
    expect(cleared.board.theme).toBeUndefined();
    expect(folder.boards.get("alpha")?.theme).toBeUndefined();
  });

  test("unknown board errors without broadcasting", async () => {
    const result = await updateBoard(ctx, { boardId: "ghost", patch: { name: "X" } });
    expect(result.ok).toBe(false);
    expect(events).toEqual([]);
  });
});

describe("board name length cap", () => {
  const tooLong = "x".repeat(MAX_BOARD_NAME_LENGTH + 1);
  const atLimit = "x".repeat(MAX_BOARD_NAME_LENGTH);

  test("add_board rejects an over-long name, accepts one at the limit", async () => {
    const rejected = await addBoard(ctx, { name: tooLong });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe("BadRequest");
    expect(events).toEqual([]);
    const accepted = unwrap(await addBoard(ctx, { name: atLimit }));
    expect(accepted.board.name).toBe(atLimit);
  });

  test("update_board rejects an over-long rename without persisting", async () => {
    const result = await updateBoard(ctx, { boardId: "alpha", patch: { name: tooLong } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BadRequest");
    expect(folder.boards.get("alpha")?.name).toBe("Alpha");
    expect(events).toEqual([]);
  });
});
