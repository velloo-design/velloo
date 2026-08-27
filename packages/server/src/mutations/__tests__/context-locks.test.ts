import { describe, expect, test } from "bun:test";
import { withScreenLock, withSnippetLock } from "../context.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

const folderA = { root: "/tmp/velloo-lock-test-a" };
const folderB = { root: "/tmp/velloo-lock-test-b" };

describe("per-folder mutation locks", () => {
  test("the same screen id in two folders does not share a chain", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = withScreenLock(folderA, "home", () => gate);
    // Would deadlock (until the test timeout) if folder B queued behind A.
    const other = await withScreenLock(folderB, "home", async () => "b-ran");
    expect(other).toBe("b-ran");
    release();
    await held;
  });

  test("the same folder + screen id still serializes", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = withScreenLock(folderA, "home", async () => {
      await gate;
      order.push("first");
    });
    const second = withScreenLock(folderA, "home", async () => {
      order.push("second");
    });
    await tick();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  test("a snippet-tree screen id shares its chain with the direct snippet lock", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const viaTree = withScreenLock(folderA, "snippet:card", async () => {
      await gate;
      order.push("tree");
    });
    const direct = withSnippetLock(folderA, "card", async () => {
      order.push("direct");
    });
    await tick();
    expect(order).toEqual([]);
    release();
    await Promise.all([viaTree, direct]);
    expect(order).toEqual(["tree", "direct"]);
  });
});
