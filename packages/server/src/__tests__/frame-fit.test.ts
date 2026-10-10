import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Board } from "@velloo/schema";
import { createFrameFitter, fitFramesTo } from "../frame-fit.ts";
import { addFrame, setScreenTree, updateFrames } from "../mutations/index.ts";
import { type TestContext, testContext } from "../testing/design-folder.ts";

let t: TestContext;

const BOARD: Board = {
  id: "main",
  name: "Main",
  frames: [
    { id: "follows", screen: "page", x: 0, y: 0, w: 1440, h: 900, fit: "content" },
    { id: "sized", screen: "page", x: 1600, y: 0, w: 1440, h: 900 },
    { id: "phone", screen: "page", x: 3200, y: 0, w: 390, h: 844, fit: "content" },
  ],
  groups: [],
};

const frame = (id: string) => t.folder.boards.get("main")?.frames.find((f) => f.id === id);

// A folder per test: each one resizes the same three frames.
beforeEach(async () => {
  t = await testContext({
    label: "frame-fit",
    config: {
      viewportPresets: [
        { name: "Desktop", w: 1440, h: 900 },
        { name: "Mobile", w: 390, h: 844 },
      ],
    },
    screens: { page: true },
    boards: { main: BOARD },
  });
});

afterEach(async () => {
  await t.cleanup();
});

describe("a frame that follows its screen", () => {
  test("takes the height a capture saw at its own width, and only then", async () => {
    const fitted = await fitFramesTo(t.ctx, "page", 2310, 1440);
    expect(fitted).toEqual([{ board: "main", frame: "follows", h: 2310 }]);
    expect(frame("follows")).toMatchObject({ h: 2310, fit: "content" });
    // Somebody sized this one, and a desktop render says nothing about a phone.
    expect(frame("sized")?.h).toBe(900);
    expect(frame("phone")?.h).toBe(844);
  });

  test("a pixel of rounding between two renders writes nothing", async () => {
    await fitFramesTo(t.ctx, "page", 2310, 1440);
    expect(await fitFramesTo(t.ctx, "page", 2311, 1440)).toEqual([]);
    expect(frame("follows")?.h).toBe(2310);
  });

  test("a page shorter than its viewport still shows as the viewport", async () => {
    await fitFramesTo(t.ctx, "page", 2310, 1440);
    await fitFramesTo(t.ctx, "page", 300, 1440);
    expect(frame("follows")?.h).toBe(900);
    // No preset names this width, so there is no viewport to hold it to.
    unwrap(
      await addFrame(t.ctx, {
        boardId: "main",
        screenId: "page",
        id: "odd",
        w: 777,
        h: 500,
        fit: "content",
      }),
    );
    await fitFramesTo(t.ctx, "page", 300, 777);
    expect(frame("odd")?.h).toBe(300);
  });

  test("stops following when its height is set, not when it is moved", async () => {
    const move = { frameId: "follows", patch: { x: 40, y: 40, w: 1440, h: 900 } };
    unwrap(await updateFrames(t.ctx, { boardId: "main", patches: [move] }));
    expect(frame("follows")).toMatchObject({ x: 40, fit: "content" });
    unwrap(
      await updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "follows", patch: { h: 1200 } }],
      }),
    );
    expect(frame("follows")?.fit).toBeUndefined();
    expect(await fitFramesTo(t.ctx, "page", 3000, 1440)).toEqual([]);
    // …and follows again when asked to.
    unwrap(
      await updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "follows", patch: { fit: "content" } }],
      }),
    );
    await fitFramesTo(t.ctx, "page", 3000, 1440);
    expect(frame("follows")).toMatchObject({ h: 3000, fit: "content" });
    unwrap(
      await updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "follows", patch: { fit: null } }],
      }),
    );
    expect(frame("follows")).toMatchObject({ h: 3000 });
    expect(frame("follows")?.fit).toBeUndefined();
  });
});

describe("fitting after an edit", () => {
  test("a burst of edits is measured once, at each width that follows, and an unchanged tree not at all", async () => {
    const seen: number[] = [];
    const frames = createFrameFitter(
      t.ctx,
      async (_screen, viewport) => {
        seen.push(viewport.w);
        return viewport.w === 390 ? 5200 : 1800;
      },
      5,
    );
    const edit = async (text: string) =>
      unwrap(
        await setScreenTree(t.ctx, {
          screenId: "page",
          tree: { $ref: "Card", props: {}, children: [{ $text: text }] },
        }),
      );
    await edit("one");
    frames.later("page");
    await edit("two");
    frames.later("page");
    frames.later("page");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen.sort()).toEqual([1440, 390]);
    expect(frame("follows")?.h).toBe(1800);
    expect(frame("phone")?.h).toBe(5200);
    expect(frame("sized")?.h).toBe(900);

    // A read names the screen too; nothing changed, so nothing is measured.
    frames.later("page");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toHaveLength(2);
  });

  test("a new width, or a frame that starts following, is measured though the tree is the same", async () => {
    const seen: number[] = [];
    t.ctx.frames = createFrameFitter(
      t.ctx,
      async (_screen, viewport) => {
        seen.push(viewport.w);
        return viewport.w === 1024 ? 2600 : 1800;
      },
      5,
    );
    try {
      await t.ctx.frames.fit("page");
      seen.length = 0;
      // Somebody sized this one; asking it to follow measures it at once.
      unwrap(
        await updateFrames(t.ctx, {
          boardId: "main",
          patches: [{ frameId: "sized", patch: { w: 1024, fit: "content" } }],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(seen).toContain(1024);
      expect(frame("sized")).toMatchObject({ w: 1024, h: 2600, fit: "content" });
      // The fitter's own write carries a height, and is not a reason to measure again.
      const after = seen.length;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(seen).toHaveLength(after);
      // A height is someone sizing it: no measurement, and it stops following.
      unwrap(
        await updateFrames(t.ctx, {
          boardId: "main",
          patches: [{ frameId: "sized", patch: { h: 900 } }],
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(seen).toHaveLength(after);
      expect(frame("sized")).toMatchObject({ h: 900 });
      expect(frame("sized")?.fit).toBeUndefined();
    } finally {
      delete t.ctx.frames;
    }
  });

  test("a screen no frame follows is never measured", async () => {
    let measured = 0;
    const frames = createFrameFitter(
      t.ctx,
      async () => {
        measured += 1;
        return 1000;
      },
      5,
    );
    frames.later("missing");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(measured).toBe(0);
  });
});
