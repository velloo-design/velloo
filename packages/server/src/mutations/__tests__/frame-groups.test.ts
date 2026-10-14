import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Board } from "@velloo/schema";
import { designBoard, testContext } from "../../testing/design-folder.ts";
import { addFrame, type MutationContext, updateFrames } from "../index.ts";

/**
 * A frame's `group` names one of its board's `groups`. It used to be written
 * as given, so an agent naming a group ("Checkout") filed the frame under an
 * id nothing defined. It resolves the way a board's sidebar group does: an
 * existing group by id or name, or a new name that creates the group.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

beforeEach(async () => {
  folder = await testContext({
    label: "frame-groups",
    screens: { home: true, cart: true },
    boards: {
      main: designBoard("main", [], {
        frames: [
          { id: "home", screen: "home", x: 0, y: 0, w: 1440, h: 900 },
          // Written before groups were checked: an id no group defines.
          { id: "legacy", screen: "home", x: 1600, y: 0, w: 390, h: 844, group: "stale-region" },
        ],
        groups: [{ id: "onboarding", name: "Onboarding" }],
      }),
    },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

const board = (): Board => ctx.folder.boards.get("main") as Board;
const frame = (id: string) => board().frames.find((f) => f.id === id);
const onDisk = async (): Promise<Board> =>
  (await Bun.file(join(folder.root, "boards/main.json")).json()) as Board;

describe("add_frame { group }", () => {
  test("a new name creates the group and files the frame under its id", async () => {
    const { frame: added } = unwrap(
      await addFrame(ctx, { boardId: "main", screenId: "cart", w: 390, h: 844, group: "Checkout" }),
    );
    expect(added.group).toBe("checkout");
    expect(board().groups).toContainEqual({ id: "checkout", name: "Checkout" });
    expect((await onDisk()).groups.map((g) => g.id)).toEqual(["onboarding", "checkout"]);
  });

  test("an existing group's name — in any case — or id joins it", async () => {
    for (const group of ["onboarding", "ONBOARDING", "Onboarding"]) {
      const { frame: added } = unwrap(
        await addFrame(ctx, { boardId: "main", screenId: "cart", w: 390, h: 844, group }),
      );
      expect(added.group).toBe("onboarding");
    }
    expect(board().groups).toHaveLength(1);
  });

  test("an empty name is a typed error, and nothing is written", async () => {
    const result = await addFrame(ctx, {
      boardId: "main",
      screenId: "cart",
      w: 390,
      h: 844,
      group: "  ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BadRequest");
    expect(board().frames).toHaveLength(2);
  });
});

describe("update_frame { group }", () => {
  test("two frames naming one new group in one write share it", async () => {
    const { frames } = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [
          { frameId: "home", patch: { group: "Variants" } },
          { frameId: "legacy", patch: { group: "variants" } },
        ],
      }),
    );
    expect(frames.map((f) => f.group)).toEqual(["variants", "variants"]);
    expect(board().groups.filter((g) => g.name === "Variants")).toHaveLength(1);
  });

  test("null ungroups the frame and leaves the group defined", async () => {
    unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { group: "Onboarding" } }],
      }),
    );
    unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { group: null } }],
      }),
    );
    expect(frame("home")?.group).toBeUndefined();
    expect(board().groups.map((g) => g.id)).toEqual(["onboarding"]);
  });

  test("a group name past the cap is refused before anything is written", async () => {
    const result = await updateFrames(ctx, {
      boardId: "main",
      patches: [
        { frameId: "home", patch: { x: 40 } },
        { frameId: "legacy", patch: { group: "x".repeat(41) } },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BadRequest");
    expect(frame("home")?.x).toBe(0);
  });

  test("a frame already under an unknown id keeps it through other edits", async () => {
    unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        // The canvas resends what it has; restating the current group is no change.
        patches: [{ frameId: "legacy", patch: { x: 1700, group: "stale-region" } }],
      }),
    );
    expect(frame("legacy")?.group).toBe("stale-region");
    expect(board().groups.map((g) => g.id)).toEqual(["onboarding"]);
    const saved = await onDisk();
    expect(saved.frames.find((f) => f.id === "legacy")?.group).toBe("stale-region");
    expect(saved.groups).toEqual([{ id: "onboarding", name: "Onboarding" }]);
  });
});
