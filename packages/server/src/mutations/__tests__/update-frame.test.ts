import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import { testContext } from "../../testing/design-folder.ts";
import { type MutationContext, updateFrames } from "../index.ts";

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

beforeEach(async () => {
  folder = await testContext({
    label: "update-frame",
    boards: {
      main: {
        id: "main",
        name: "Main",
        frames: [{ id: "home", screen: "home", x: 0, y: 0, w: 1440, h: 900 }],
        groups: [],
      } as never,
    },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

describe("update_frame scheme", () => {
  test("sets and explicitly clears a frame scheme", async () => {
    const pinned = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: "dark" } }],
      }),
    );
    expect(pinned.frames[0]?.scheme).toBe("dark");
    expect(ctx.folder.boards.get("main")?.frames[0]?.scheme).toBe("dark");

    const cleared = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: null } }],
      }),
    );
    expect(cleared.frames[0]?.scheme).toBeUndefined();
    expect(ctx.folder.boards.get("main")?.frames[0]?.scheme).toBeUndefined();

    const persisted = (await Bun.file(join(folder.root, "boards/main.json")).json()) as {
      frames: Array<Record<string, unknown>>;
    };
    expect(persisted.frames[0]).not.toHaveProperty("scheme");
  });

  test("an omitted scheme leaves the existing pin unchanged", async () => {
    unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: "light" } }],
      }),
    );
    const updated = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { x: 12 } }],
      }),
    );
    expect(updated.frames[0]?.scheme).toBe("light");
  });
});
