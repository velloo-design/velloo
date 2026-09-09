import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Snippet } from "@velloo/schema";
import {
  designBoard,
  designScreen,
  type TestContext,
  testContext,
} from "../../testing/design-folder.ts";
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
    expect(result.removedSnippetIds).toEqual([]);
    expect((await t.reload()).screens.size).toBe(4);
  });
});

/**
 * The snippet half of the same cascade. A snippet has no placement of its own,
 * so once the last screen reaching it is gone it renders nowhere — but it used
 * to stay on disk, listed in a library that couldn't say it was dead.
 */
describe("remove_board's snippet cascade", () => {
  let s: TestContext;

  const snippet = (id: string, tree: unknown): Snippet =>
    ({ id, name: id, params: [], tree }) as Snippet;

  /**
   *   doomed ─> only-here ──> hero ──> ornament
   *   keep ───> kept ───────> shared <─ only-here
   *   (parked references nothing and nothing references it)
   */
  beforeEach(async () => {
    s = await testContext({
      label: "remove-board-snippets",
      screens: {
        "only-here": designScreen("only-here", {
          tree: {
            $ref: "Box",
            children: [{ $snippet: "hero" }, { $snippet: "shared" }],
          },
        }),
        kept: designScreen("kept", {
          tree: { $ref: "Box", children: [{ $snippet: "shared" }] },
        }),
      },
      boards: {
        doomed: designBoard("doomed", ["only-here"]),
        keep: designBoard("keep", ["kept"]),
      },
      snippets: {
        hero: snippet("hero", { $ref: "Box", children: [{ $snippet: "ornament" }] }),
        ornament: snippet("ornament", { $ref: "Box", children: [] }),
        shared: snippet("shared", { $ref: "Box", children: [] }),
        parked: snippet("parked", { $ref: "Box", children: [] }),
      },
    });
  });

  afterEach(() => s.cleanup());

  test("takes the snippets those screens were the last to reach", async () => {
    const result = unwrap(await removeBoard(s.ctx, { boardId: "doomed" }));

    // `ornament` only ever hung off `hero`, so it goes too — a direct-reference
    // count would have kept it, since `hero` still referenced it on the way out.
    expect(result.removedSnippetIds).toEqual(["hero", "ornament"]);
    const reloaded = await s.reload();
    expect(reloaded.snippets.has("hero")).toBe(false);
    expect(reloaded.snippets.has("ornament")).toBe(false);
  });

  test("keeps one a surviving screen still reaches", async () => {
    unwrap(await removeBoard(s.ctx, { boardId: "doomed" }));

    expect((await s.reload()).snippets.has("shared")).toBe(true);
  });

  test("leaves an already-unused snippet alone", async () => {
    // `parked` was dead before the call. Collecting it here would make an
    // unrelated board delete quietly eat a snippet someone parked on purpose.
    const result = unwrap(await removeBoard(s.ctx, { boardId: "doomed" }));

    expect(result.removedSnippetIds).not.toContain("parked");
    expect((await s.reload()).snippets.has("parked")).toBe(true);
  });

  test("broadcasts each cascaded snippet", async () => {
    unwrap(await removeBoard(s.ctx, { boardId: "doomed" }));

    expect(s.events).toContainEqual({ type: "snippet-changed", snippetId: "hero" });
    expect(s.events).toContainEqual({ type: "snippet-changed", snippetId: "ornament" });
  });

  test("undo restores the snippets before the screens that instantiate them", async () => {
    unwrap(await removeBoard(s.ctx, { boardId: "doomed" }));

    // History unwinds in reverse, so the snippets — deleted last — come back
    // first, and no intermediate state has a screen pointing at a missing body.
    const top = [s.ctx.folder.history.popUndo(), s.ctx.folder.history.popUndo()];
    expect(top.map((entry) => entry?.kind)).toEqual(["snippet", "snippet"]);
    expect(s.ctx.folder.history.popUndo()?.kind).toBe("screen");
  });
});
