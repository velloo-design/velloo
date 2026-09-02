import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { listBoardsPayload } from "../../mcp/tools/discovery.ts";
import { createDesignRouter } from "../../routes/design.ts";
import type { WatchEvent } from "../../watcher.ts";
import {
  addBoard,
  addBoardGroup,
  type MutationContext,
  removeBoardGroup,
  reorderBoardGroups,
  updateBoard,
  updateBoardGroup,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: { id: "shadcn-upstream", version: "test", source: "binary", componentsPath: "binary" },
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
  tmp = join(tmpdir(), `velloo-board-groups-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  for (const id of ["inspector", "palette"]) {
    await writeJson(join(tmp, `boards/${id}.json`), { id, name: id, frames: [], groups: [] });
  }
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

describe("update_board { group }", () => {
  test("creates the group on first use and files the board under it", async () => {
    const { board } = unwrap(
      await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } }),
    );
    const groups = ctx.folder.config.boardGroups ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("Side pane");
    expect(groups[0]?.color).toBeString();
    expect(board.group).toBe(groups[0]?.id as string);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("inspector")?.group).toBe(groups[0]?.id as string);
    expect(reloaded.config.boardGroups).toEqual(groups);
  });

  test("a second board naming the same group joins it — case-insensitively", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const { board } = unwrap(
      await updateBoard(ctx, { boardId: "palette", patch: { group: "side PANE" } }),
    );
    expect(ctx.folder.config.boardGroups).toHaveLength(1);
    expect(board.group).toBe(ctx.folder.config.boardGroups?.[0]?.id as string);
  });

  test("naming a group by its id joins it rather than forking a new one", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const groupId = ctx.folder.config.boardGroups?.[0]?.id as string;
    const { board } = unwrap(
      await updateBoard(ctx, { boardId: "palette", patch: { group: groupId } }),
    );
    expect(board.group).toBe(groupId);
    expect(ctx.folder.config.boardGroups).toHaveLength(1);
  });

  test("null files the board back under Ungrouped, leaving the group in place", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const { board } = unwrap(
      await updateBoard(ctx, { boardId: "inspector", patch: { group: null } }),
    );
    expect(board.group).toBeUndefined();
    expect(ctx.folder.config.boardGroups).toHaveLength(1);
  });

  test("add_board files a new board in one call", async () => {
    const { board } = unwrap(await addBoard(ctx, { name: "Density", group: "Side pane" }));
    expect(board.group).toBe(ctx.folder.config.boardGroups?.[0]?.id as string);
  });
});

describe("group lifecycle", () => {
  test("add assigns distinct colors from the palette", async () => {
    const a = unwrap(await addBoardGroup(ctx, { name: "Side pane" })).group;
    const b = unwrap(await addBoardGroup(ctx, { name: "Account page" })).group;
    expect(a.color).not.toBe(b.color);
  });

  test("a duplicate name gets its own id rather than colliding", async () => {
    const a = unwrap(await addBoardGroup(ctx, { name: "Nav" })).group;
    const b = unwrap(await addBoardGroup(ctx, { name: "Nav" })).group;
    expect(b.id).not.toBe(a.id);
  });

  test("rename and recolor persist", async () => {
    const { group } = unwrap(await addBoardGroup(ctx, { name: "Nav" }));
    unwrap(
      await updateBoardGroup(ctx, {
        groupId: group.id,
        patch: { name: "Navigation", color: "#123456" },
      }),
    );
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.config.boardGroups?.[0]).toEqual({
      id: group.id,
      name: "Navigation",
      color: "#123456",
    });
  });

  test("remove un-files its boards instead of deleting them", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const groupId = ctx.folder.config.boardGroups?.[0]?.id as string;
    const result = unwrap(await removeBoardGroup(ctx, { groupId }));
    expect(result.ungroupedBoardIds).toEqual(["inspector"]);
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("inspector")).toBeDefined();
    expect(reloaded.boards.get("inspector")?.group).toBeUndefined();
    // Last group out drops the field rather than leaving an empty array.
    expect(reloaded.config.boardGroups).toBeUndefined();
  });

  test("removing an unknown group is an error, not a silent no-op", async () => {
    const result = await removeBoardGroup(ctx, { groupId: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BoardGroupNotFound");
  });

  test("reorder puts named groups first and keeps the rest behind them", async () => {
    const a = unwrap(await addBoardGroup(ctx, { name: "A" })).group;
    const b = unwrap(await addBoardGroup(ctx, { name: "B" })).group;
    const c = unwrap(await addBoardGroup(ctx, { name: "C" })).group;
    const { order } = unwrap(await reorderBoardGroups(ctx, { order: [c.id, a.id, "ghost"] }));
    expect(order).toEqual([c.id, a.id, b.id]);
  });
});

describe("readers", () => {
  test("list_boards reports the group by name — the same string that files a board", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const payload = listBoardsPayload(ctx.folder);
    expect(payload.find((b) => b.id === "inspector")?.group).toBe("Side pane");
    expect(payload.find((b) => b.id === "palette")?.group).toBeUndefined();
  });

  test("/api/design serves the groups and each board's membership", async () => {
    await updateBoard(ctx, { boardId: "inspector", patch: { group: "Side pane" } });
    const res = await createDesignRouter(() => ctx).fetch(new Request("http://localhost/"));
    const body = (await res.json()) as {
      boards: { id: string; group: string | null }[];
      boardGroups: { id: string; name: string }[];
    };
    expect(body.boardGroups.map((g) => g.name)).toEqual(["Side pane"]);
    expect(body.boards.find((b) => b.id === "inspector")?.group).toBe(
      body.boardGroups[0]?.id as string,
    );
    expect(body.boards.find((b) => b.id === "palette")?.group).toBeNull();
  });

  test("group writes broadcast config-changed so other tabs reconcile", async () => {
    await addBoardGroup(ctx, { name: "Nav" });
    expect(events.filter((e) => e.type === "config-changed")).toHaveLength(1);
  });
});
