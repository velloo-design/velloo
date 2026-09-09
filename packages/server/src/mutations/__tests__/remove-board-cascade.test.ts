import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { designBoard, type TestContext, testContext } from "../../testing/design-folder.ts";
import { removeBoard } from "../index.ts";

let t: TestContext;

/**
 * `only-here` is placed by the doomed board alone, `shared` is also on `keep`,
 * and `parked` is only on an archived board — which still counts as a
 * placement, since restoring the board brings the screen back into view.
 */
beforeEach(async () => {
  t = await testContext({
    label: "remove-board-cascade",
    screens: { "only-here": true, shared: true, parked: true, elsewhere: true },
    boards: {
      doomed: designBoard("doomed", ["only-here", "shared"]),
      keep: designBoard("keep", ["shared", "elsewhere"]),
      filed: designBoard("filed", ["parked"], { archivedAt: new Date().toISOString() }),
    },
  });
});

afterEach(() => t.cleanup());

const screenFile = (id: string) => join(t.root, "screens", `${id}.json`);

describe("remove_board", () => {
  test("deletes the screens only that board placed", async () => {
    const result = unwrap(await removeBoard(t.ctx, { boardId: "doomed" }));

    expect(result.removedScreenIds).toEqual(["only-here"]);
    expect(existsSync(screenFile("only-here"))).toBe(false);
    const reloaded = await t.reload();
    expect(reloaded.screens.has("only-here")).toBe(false);
  });

  test("keeps a screen another board also places", async () => {
    unwrap(await removeBoard(t.ctx, { boardId: "doomed" }));

    expect(existsSync(screenFile("shared"))).toBe(true);
    expect((await t.reload()).screens.has("shared")).toBe(true);
  });

  test("counts an archived board as a placement", async () => {
    unwrap(await removeBoard(t.ctx, { boardId: "keep" }));

    // `elsewhere` was only on `keep`, so it goes; `parked` sits on the
    // archived board and is untouched by an unrelated delete.
    expect(existsSync(screenFile("elsewhere"))).toBe(false);
    expect(existsSync(screenFile("parked"))).toBe(true);
  });

  test("broadcasts each cascaded screen", async () => {
    unwrap(await removeBoard(t.ctx, { boardId: "doomed" }));

    expect(t.events).toContainEqual({ type: "screen-changed", screenId: "only-here" });
    expect(t.events).toContainEqual({ type: "board-changed", boardId: "doomed" });
  });

  test("leaves no screen behind when the last board goes", async () => {
    for (const boardId of ["doomed", "keep", "filed"]) {
      unwrap(await removeBoard(t.ctx, { boardId }));
    }

    const reloaded = await t.reload();
    expect(reloaded.boards.size).toBe(0);
    expect(reloaded.screens.size).toBe(0);
  });

  test("reports nothing removed for a board that places no screens", async () => {
    await t.write("boards/empty.json", designBoard("empty", []));
    await t.reload();

    const result = unwrap(await removeBoard(t.ctx, { boardId: "empty" }));

    expect(result.removedScreenIds).toEqual([]);
    expect((await t.reload()).screens.size).toBe(4);
  });
});
