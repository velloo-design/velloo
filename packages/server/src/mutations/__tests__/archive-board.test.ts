import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { isArchived, type Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import {
  activeBoards,
  type DesignFolder,
  loadDesignFolder,
  orderedBoards,
  pinnedThemeForScreen,
} from "../../design-folder.ts";
import { listBoardsPayload } from "../../mcp/tools/discovery.ts";
import { createBoardRouter, createDesignRouter } from "../../routes/design.ts";
import { createMutateRouter } from "../../routes/mutate.ts";
import { searchFolder } from "../../search.ts";
import { listThemes } from "../../theme/index.ts";
import type { WatchEvent } from "../../watcher.ts";
import { type MutationContext, removeBoard, removeScreen, updateBoard } from "../index.ts";

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

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function frame(id: string, screen: string) {
  return { id, screen, x: 0, y: 0, w: 1440, h: 900 };
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-archive-board-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "theme/candidate.json"), { ...sampleTheme, name: "candidate" });
  for (const id of ["home", "pricing"]) {
    await writeJson(join(tmp, `screens/${id}.json`), {
      id,
      name: id,
      tree: { $ref: "Box", props: {}, children: [] },
    });
  }
  // Filenames load alphabetically: live, parked, second.
  await writeJson(join(tmp, "boards/live.json"), {
    id: "live",
    name: "Live flow",
    frames: [frame("f-home", "home")],
    groups: [],
  });
  await writeJson(join(tmp, "boards/parked.json"), {
    id: "parked",
    name: "Parked exploration",
    theme: "candidate",
    frames: [frame("f-home-2", "home"), frame("f-pricing", "pricing")],
    groups: [],
  });
  await writeJson(join(tmp, "boards/second.json"), {
    id: "second",
    name: "Second flow",
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

/** Archive `parked` through the real mutation. */
async function archiveParked() {
  return unwrap(await updateBoard(ctx, { boardId: "parked", patch: { archived: true } }));
}

describe("update_board { archived }", () => {
  test("stamps archivedAt, persists, and broadcasts board-changed", async () => {
    const before = Date.now();
    const result = await archiveParked();
    expect(isArchived(result.board)).toBe(true);
    const stamped = Date.parse(result.board.archivedAt as string);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(events.filter((e) => e.type !== "activity")).toEqual([
      { type: "board-changed", boardId: "parked" },
    ]);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("parked")?.archivedAt).toBe(result.board.archivedAt);
  });

  test("archived:false clears the stamp", async () => {
    await archiveParked();
    const restored = unwrap(
      await updateBoard(ctx, { boardId: "parked", patch: { archived: false } }),
    );
    expect(restored.board.archivedAt).toBeUndefined();
    expect(isArchived(restored.board)).toBe(false);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("parked")?.archivedAt).toBeUndefined();
  });

  test("archiving leaves frames, groups, and the theme pin untouched on disk", async () => {
    await archiveParked();
    const reloaded = await loadDesignFolder(tmp);
    const board = reloaded.boards.get("parked");
    expect(board?.frames.map((f) => f.id)).toEqual(["f-home-2", "f-pricing"]);
    expect(board?.theme).toBe("candidate");
    // The screens it placed are untouched too.
    expect([...reloaded.screens.keys()].sort()).toEqual(["home", "pricing"]);
  });
});

describe("activeBoards", () => {
  test("drops archived boards but keeps orderedBoards total", async () => {
    await archiveParked();
    expect(activeBoards(folder).map(([id]) => id)).toEqual(["live", "second"]);
    expect(orderedBoards(folder).map(([id]) => id)).toEqual(["live", "parked", "second"]);
  });
});

describe("no last-board rule", () => {
  test("every board can be archived", async () => {
    for (const id of ["live", "parked", "second"]) {
      unwrap(await updateBoard(ctx, { boardId: id, patch: { archived: true } }));
    }
    expect(activeBoards(folder)).toEqual([]);
    expect(folder.boards.size).toBe(3);
  });

  test("the last board can be deleted", async () => {
    for (const id of ["live", "parked", "second"]) {
      unwrap(await removeBoard(ctx, { boardId: id }));
    }
    expect(folder.boards.size).toBe(0);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.size).toBe(0);
  });
});

describe("integrity scans still see archived boards", () => {
  test("remove_screen prunes frames inside an archived board", async () => {
    await archiveParked();
    const result = unwrap(await removeScreen(ctx, { screenId: "pricing" }));
    expect(result.removedFrames).toEqual([{ boardId: "parked", frameIds: ["f-pricing"] }]);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("parked")?.frames.map((f) => f.id)).toEqual(["f-home-2"]);
    // Still archived after the prune — pruning is not an unarchive.
    expect(reloaded.boards.get("parked")?.archivedAt).toBeDefined();
  });

  test("an archived board still counts as a user of its named theme", async () => {
    await archiveParked();
    // listThemes gates theme deletion — filtering archived here would let a
    // theme an archived board still pins be deleted out from under it.
    const candidate = listThemes(ctx).themes.find((t) => t.name === "candidate");
    expect(candidate?.usedByBoards).toEqual(["parked"]);
  });
});

describe("pinnedThemeForScreen ignores archived boards", () => {
  test("a parked board's theme pin can't wedge a shared screen's screenshot", async () => {
    // Both boards place `home`; they disagree on theme, so the live folder
    // refuses to guess.
    const conflicted = pinnedThemeForScreen(folder, "home");
    expect(conflicted.ok).toBe(false);

    await archiveParked();
    const resolved = pinnedThemeForScreen(folder, "home");
    expect(resolved).toEqual({ ok: true, name: undefined });
  });
});

describe("search surfaces archived boards, ranked last", () => {
  test("an archived board still matches, flagged, below live hits", async () => {
    await archiveParked();
    const hits = searchFolder(folder, "flow").boards;
    expect(hits.map((b) => b.id)).toEqual(["live", "second"]);

    const all = searchFolder(folder, "o").boards;
    // "Parked exploration" matches too, but every live hit comes first.
    const archivedIndex = all.findIndex((b) => b.archived);
    expect(archivedIndex).toBeGreaterThan(-1);
    expect(all.slice(0, archivedIndex).every((b) => !b.archived)).toBe(true);
    expect(all[archivedIndex]?.id).toBe("parked");
  });

  test("a screen's board chips put live hosts before archived ones", async () => {
    await archiveParked();
    const hit = searchFolder(folder, "home").screens.find((s) => s.id === "home");
    expect(hit?.boards.map((b) => ({ id: b.id, archived: b.archived }))).toEqual([
      { id: "live", archived: false },
      { id: "parked", archived: true },
    ]);
  });
});

describe("GET /api/design", () => {
  const summary = async () => {
    const res = await createDesignRouter(() => ctx).fetch(new Request("http://localhost/"));
    return (await res.json()) as {
      boards: { id: string }[];
      archivedBoards: { id: string; archivedAt: string | null }[];
    };
  };

  test("serves live boards in `boards` and archived ones separately", async () => {
    expect((await summary()).archivedBoards).toEqual([]);
    const { board } = await archiveParked();
    const after = await summary();
    expect(after.boards.map((b) => b.id)).toEqual(["live", "second"]);
    expect(after.archivedBoards).toEqual([
      { id: "parked", name: "Parked exploration", frameCount: 2, archivedAt: board.archivedAt },
    ] as never);
  });

  test("an archived board is still fetchable by id — archive is not lock", async () => {
    await archiveParked();
    const res = await createBoardRouter(() => folder).fetch(new Request("http://localhost/parked"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { frames: unknown[] }).frames).toHaveLength(2);
  });
});

describe("MCP list_boards", () => {
  test("hides archived boards by default", async () => {
    await archiveParked();
    expect(listBoardsPayload(folder).map((b) => b.id)).toEqual(["live", "second"]);
    expect(listBoardsPayload(folder).some((b) => "archivedAt" in b)).toBe(false);
  });

  test("include_archived restores them, stamped and in sidebar order", async () => {
    const { board } = await archiveParked();
    const rows = listBoardsPayload(folder, { include_archived: true });
    expect(rows.map((b) => b.id)).toEqual(["live", "parked", "second"]);
    expect(rows.find((b) => b.id === "parked")?.archivedAt).toBe(board.archivedAt as string);
  });

  test("include_frames still embeds an archived board's frames", async () => {
    await archiveParked();
    const rows = listBoardsPayload(folder, { include_archived: true, include_frames: true });
    const parked = rows.find((b) => b.id === "parked") as { frames: { id: string }[] };
    expect(parked.frames.map((f) => f.id)).toEqual(["f-home-2", "f-pricing"]);
  });
});

describe("POST /api/mutate/update_board", () => {
  /**
   * The canvas archives through this route, not the mutation directly. Its
   * Zod body schema strips unknown keys, so a patch field that exists on the
   * mutation but not here fails silently — the call 200s and nothing changes.
   * That's exactly what happened to `archived` before this test.
   */
  const post = (body: unknown) =>
    createMutateRouter(() => ctx).fetch(
      new Request("http://localhost/update_board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("carries `archived` through to the board file", async () => {
    const res = await post({ boardId: "parked", patch: { archived: true } });
    expect(res.status).toBe(200);
    expect(folder.boards.get("parked")?.archivedAt).toBeDefined();
    expect((await loadDesignFolder(tmp)).boards.get("parked")?.archivedAt).toBeDefined();
  });

  test("archived:false over the route restores the board", async () => {
    await post({ boardId: "parked", patch: { archived: true } });
    const res = await post({ boardId: "parked", patch: { archived: false } });
    expect(res.status).toBe(200);
    expect(folder.boards.get("parked")?.archivedAt).toBeUndefined();
  });
});
