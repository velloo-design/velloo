import { describe, expect, test } from "bun:test";
import { createLockMap } from "../locks.ts";

/** Flush the microtask queue (eviction runs in a then-callback after a tail settles). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createLockMap", () => {
  test("serializes callers on the same key", async () => {
    const locks = createLockMap();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = locks.run("k", async () => {
      await gate;
      order.push("first");
    });
    const second = locks.run("k", async () => {
      order.push("second");
    });
    await tick();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  test("distinct keys run in parallel", async () => {
    const locks = createLockMap();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const blocked = locks.run("a", () => gate);
    // Would hang here if "b" queued behind "a"'s open gate.
    const other = await locks.run("b", async () => "done");
    expect(other).toBe("done");
    release();
    await blocked;
  });

  test("a drained chain is evicted; an active one is kept", async () => {
    const locks = createLockMap();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = locks.run("k", () => gate);
    const second = locks.run("k", async () => undefined);
    expect(locks.size).toBe(1);
    release();
    await Promise.all([first, second]);
    await tick();
    expect(locks.size).toBe(0);
  });

  test("a rejection neither poisons the chain nor leaks an entry", async () => {
    const locks = createLockMap();
    await expect(
      locks.run("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await locks.run("k", async () => "recovered");
    expect(after).toBe("recovered");
    await tick();
    expect(locks.size).toBe(0);
  });
});
