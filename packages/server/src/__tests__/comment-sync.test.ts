import { afterEach, describe, expect, test } from "bun:test";
import { CommentSyncScheduler } from "../comment-sync.ts";

/**
 * The cloud-comment pull. Real timers at millisecond scale: the point is the
 * choice between cadences, and a watched/idle ratio this wide makes it
 * unambiguous which one fired.
 */

const cadence = { watchedMs: 20, idleMs: 60_000, minGapMs: 50 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let scheduler: CommentSyncScheduler | undefined;
afterEach(() => scheduler?.stop());

function harness(watchers: { count: number }, sync: () => Promise<unknown> = async () => {}) {
  let runs = 0;
  scheduler = new CommentSyncScheduler(
    async () => {
      runs += 1;
      await sync();
    },
    () => watchers.count,
    cadence,
  );
  return { scheduler, runs: () => runs };
}

describe("comment sync cadence", () => {
  test("pulls once at start and then waits the idle interval when nobody is watching", async () => {
    const { scheduler, runs } = harness({ count: 0 });
    scheduler.start();
    await wait(80);
    expect(runs()).toBe(1);
  });

  test("pulls on the watched cadence while a canvas is connected", async () => {
    const { scheduler, runs } = harness({ count: 1 });
    scheduler.start();
    await wait(110);
    expect(runs()).toBeGreaterThanOrEqual(2);
  });

  test("a canvas connecting pulls immediately and switches to the watched cadence", async () => {
    const watchers = { count: 0 };
    const { scheduler, runs } = harness(watchers);
    scheduler.start();
    await wait(cadence.minGapMs + 10);
    expect(runs()).toBe(1);

    watchers.count = 1;
    scheduler.watcherJoined();
    await scheduler.settled();
    expect(runs()).toBe(2);
    await wait(70);
    expect(runs()).toBeGreaterThanOrEqual(3);
  });

  test("a reconnect right after a pull does not pull again, but still speeds up", async () => {
    const watchers = { count: 0 };
    const { scheduler, runs } = harness(watchers);
    scheduler.start();
    await scheduler.settled();
    watchers.count = 1;
    scheduler.watcherJoined();
    scheduler.watcherJoined();
    expect(runs()).toBe(1);
    await wait(35);
    expect(runs()).toBeGreaterThanOrEqual(2);
  });

  test("a failing sync never escapes and never stops the loop", async () => {
    const { scheduler, runs } = harness({ count: 1 }, async () => {
      throw new Error("cloud down");
    });
    scheduler.start();
    await wait(70);
    expect(runs()).toBeGreaterThanOrEqual(2);
  });

  test("stop cancels the next pull", async () => {
    const { scheduler, runs } = harness({ count: 1 });
    scheduler.start();
    await scheduler.settled();
    scheduler.stop();
    scheduler.watcherJoined();
    await wait(60);
    expect(runs()).toBe(1);
  });
});
