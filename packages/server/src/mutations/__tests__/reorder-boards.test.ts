import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder, orderedBoards } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { type MutationContext, removeBoard, reorderBoards } from "../index.ts";

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

function board(id: string) {
  return { id, name: id, frames: [], groups: [] };
}

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-reorder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  // Filenames load alphabetically: alpha, beta, gamma.
  await writeJson(join(tmp, "boards/alpha.json"), board("alpha"));
  await writeJson(join(tmp, "boards/beta.json"), board("beta"));
  await writeJson(join(tmp, "boards/gamma.json"), board("gamma"));
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

describe("reorder_boards", () => {
  test("defaults to filename order when boardOrder is absent", () => {
    expect(orderedBoards(folder).map(([id]) => id)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("persists a new order; omitted boards are appended", async () => {
    const result = unwrap(await reorderBoards(ctx, { order: ["gamma", "alpha"] }));
    // beta wasn't named, so it's appended after the explicit ids.
    expect(result.order).toEqual(["gamma", "alpha", "beta"]);
    expect(folder.config.boardOrder).toEqual(["gamma", "alpha", "beta"]);
    expect(orderedBoards(folder).map(([id]) => id)).toEqual(["gamma", "alpha", "beta"]);
    expect(events.filter((e) => e.type !== "activity")).toEqual([{ type: "config-changed" }]);
  });

  test("drops unknown ids and de-duplicates", async () => {
    const result = unwrap(await reorderBoards(ctx, { order: ["beta", "ghost", "beta", "gamma"] }));
    expect(result.order).toEqual(["beta", "gamma", "alpha"]);
  });

  test("survives a reload from disk", async () => {
    unwrap(await reorderBoards(ctx, { order: ["gamma", "beta", "alpha"] }));
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.config.boardOrder).toEqual(["gamma", "beta", "alpha"]);
    expect(orderedBoards(reloaded).map(([id]) => id)).toEqual(["gamma", "beta", "alpha"]);
  });

  test("a stale id in boardOrder is skipped by orderedBoards", () => {
    folder.config = { ...folder.config, boardOrder: ["gamma", "deleted", "alpha"] };
    expect(orderedBoards(folder).map(([id]) => id)).toEqual(["gamma", "alpha", "beta"]);
  });

  test("remove_board prunes the deleted id from boardOrder", async () => {
    unwrap(await reorderBoards(ctx, { order: ["gamma", "beta", "alpha"] }));
    unwrap(await removeBoard(ctx, { boardId: "beta" }));
    expect(folder.config.boardOrder).toEqual(["gamma", "alpha"]);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.config.boardOrder).toEqual(["gamma", "alpha"]);
  });

  test("remove_board drops boardOrder entirely when nothing is left", async () => {
    // A partial (hand-authored) order naming only the board we delete:
    // pruning empties it, so the field is cleared rather than stored as [].
    folder.config = { ...folder.config, boardOrder: ["beta"] };
    unwrap(await removeBoard(ctx, { boardId: "beta" }));
    expect(folder.config.boardOrder).toBeUndefined();
  });
});
