import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import { MAX_BOARD_NAME_LENGTH } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
import { addBoard, type MutationContext, updateBoard } from "../index.ts";

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

beforeEach(async () => {
  folder = await testContext({
    label: "update-board",
    boards: { alpha: { id: "alpha", name: "Alpha", frames: [], groups: [] } as never },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

describe("update_board", () => {
  test("renames the board, persists, and broadcasts board-changed", async () => {
    const result = unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { name: "Flows" } }));
    expect(result.board.name).toBe("Flows");
    expect(ctx.folder.boards.get("alpha")?.name).toBe("Flows");
    expect(folder.events.filter((e) => e.type !== "activity")).toEqual([
      { type: "board-changed", boardId: "alpha" },
    ]);
    const reloaded = await folder.reload();
    expect(reloaded.boards.get("alpha")?.name).toBe("Flows");
  });

  test("sets and clears the board theme", async () => {
    unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { theme: "dark" } }));
    expect(ctx.folder.boards.get("alpha")?.theme).toBe("dark");
    const cleared = unwrap(await updateBoard(ctx, { boardId: "alpha", patch: { theme: null } }));
    expect(cleared.board.theme).toBeUndefined();
    expect(ctx.folder.boards.get("alpha")?.theme).toBeUndefined();
  });

  test("unknown board errors without broadcasting", async () => {
    const result = await updateBoard(ctx, { boardId: "ghost", patch: { name: "X" } });
    expect(result.ok).toBe(false);
    expect(folder.events).toEqual([]);
  });
});

describe("board name length cap", () => {
  const tooLong = "x".repeat(MAX_BOARD_NAME_LENGTH + 1);
  const atLimit = "x".repeat(MAX_BOARD_NAME_LENGTH);

  test("add_board rejects an over-long name, accepts one at the limit", async () => {
    const rejected = await addBoard(ctx, { name: tooLong });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe("BadRequest");
    expect(folder.events).toEqual([]);
    const accepted = unwrap(await addBoard(ctx, { name: atLimit }));
    expect(accepted.board.name).toBe(atLimit);
  });

  test("update_board rejects an over-long rename without persisting", async () => {
    const result = await updateBoard(ctx, { boardId: "alpha", patch: { name: tooLong } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BadRequest");
    expect(ctx.folder.boards.get("alpha")?.name).toBe("Alpha");
    expect(folder.events).toEqual([]);
  });
});
