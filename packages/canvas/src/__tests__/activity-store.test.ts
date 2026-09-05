import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Board } from "@velloo/schema";
import { type ActivityEntry, parseActivityEntry } from "../store/activity.ts";
import { useCanvas } from "../store.ts";

/**
 * The agent-activity slice turns the server's WS events into every
 * ambient cue on the canvas — node flashes, frame glows, board badges, the
 * indicator pulse. It sat at 2% coverage, and its rules are the kind that
 * regress quietly: a wrong cue is a distraction, not an error, so nothing
 * fails loudly when the routing drifts.
 */

const frame = (id: string, screen: string) => ({
  id,
  screen,
  x: 0,
  y: 0,
  viewport: { w: 1440, h: 900 },
});

const board = (id: string, frames: ReturnType<typeof frame>[]): Board =>
  ({ id, name: id, frames }) as unknown as Board;

let nextId = 0;
const event = (partial: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: ++nextId,
  ts: 1_700_000_000_000,
  verb: "update_props",
  source: "mcp",
  target: {},
  ...partial,
});

const realFetch = globalThis.fetch;

beforeEach(() => {
  nextId = 0;
  useCanvas.setState({
    activityEvents: [],
    activityFeedOpen: false,
    lastAgentActivityAt: null,
    activityFlash: {},
    frameGlow: {},
    boardPulse: {},
    currentBoardId: "main",
    boards: {
      main: board("main", [frame("f1", "home"), frame("f2", "home"), frame("f3", "pricing")]),
      other: board("other", [frame("f4", "home")]),
    },
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseActivityEntry", () => {
  test("accepts a well-formed event from each source", () => {
    for (const source of ["mcp", "canvas", "cli"] as const) {
      expect(
        parseActivityEntry({ id: 1, ts: 2, verb: "compose", source, target: {} }),
      ).not.toBeNull();
    }
  });

  test("rejects anything the WS could hand it that isn't one", () => {
    const base = { id: 1, ts: 2, verb: "compose", source: "mcp", target: {} };
    expect(parseActivityEntry(null)).toBeNull();
    expect(parseActivityEntry("activity")).toBeNull();
    expect(parseActivityEntry({ ...base, id: "1" })).toBeNull();
    expect(parseActivityEntry({ ...base, ts: undefined })).toBeNull();
    expect(parseActivityEntry({ ...base, verb: 42 })).toBeNull();
    expect(parseActivityEntry({ ...base, source: "agent" })).toBeNull();
    expect(parseActivityEntry({ ...base, target: undefined })).toBeNull();
  });
});

describe("recordActivity — the feed", () => {
  test("appends in arrival order", () => {
    const record = useCanvas.getState().recordActivity;
    record(event({ verb: "one" }));
    record(event({ verb: "two" }));
    expect(useCanvas.getState().activityEvents.map((e) => e.verb)).toEqual(["one", "two"]);
  });

  test("keeps a bounded ring, dropping the oldest", () => {
    const record = useCanvas.getState().recordActivity;
    for (let i = 0; i < 250; i++) record(event({ verb: `v${i}` }));
    const events = useCanvas.getState().activityEvents;
    expect(events).toHaveLength(200);
    expect(events[0]?.verb).toBe("v50");
    expect(events.at(-1)?.verb).toBe("v249");
  });

  test("records canvas-sourced events too — they just don't cue", () => {
    useCanvas.getState().recordActivity(event({ source: "canvas", target: { screenId: "home" } }));
    expect(useCanvas.getState().activityEvents).toHaveLength(1);
    expect(useCanvas.getState().frameGlow).toEqual({});
    expect(useCanvas.getState().lastAgentActivityAt).toBeNull();
  });
});

describe("recordActivity — cues", () => {
  test("a node-level edit flashes that node once per screen, not per frame", () => {
    useCanvas.getState().recordActivity(event({ target: { screenId: "home", path: [0, 2] } }));
    expect(useCanvas.getState().activityFlash).toEqual({ home: { nonce: 1, path: "0.2" } });
    // Frames re-read the nonce; a node flash must not also glow the frame.
    expect(useCanvas.getState().frameGlow).toEqual({});
  });

  test("a burst bumps the nonce so frames read one sustained pulse", () => {
    const record = useCanvas.getState().recordActivity;
    record(event({ target: { screenId: "home", path: [0] } }));
    record(event({ target: { screenId: "home", path: [1] } }));
    expect(useCanvas.getState().activityFlash.home).toEqual({ nonce: 2, path: "1" });
  });

  test("a screen-level edit glows every frame showing it on the visible board", () => {
    useCanvas.getState().recordActivity(event({ target: { screenId: "home" } }));
    // f1 and f2 show home; f3 shows pricing; f4 is on another board.
    expect(useCanvas.getState().frameGlow).toEqual({ f1: 1, f2: 1 });
  });

  test("a theme edit glows the whole visible board", () => {
    useCanvas
      .getState()
      .recordActivity(event({ verb: "set_theme", target: { themeName: "dark" } }));
    expect(useCanvas.getState().frameGlow).toEqual({ f1: 1, f2: 1, f3: 1 });
  });

  test("a single token edit counts as a theme edit", () => {
    useCanvas.getState().recordActivity(event({ target: { token: "primary" } }));
    expect(Object.keys(useCanvas.getState().frameGlow).sort()).toEqual(["f1", "f2", "f3"]);
  });

  test("an explicit frame target glows just that frame", () => {
    useCanvas.getState().recordActivity(event({ target: { frameId: "f3" } }));
    expect(useCanvas.getState().frameGlow).toEqual({ f3: 1 });
  });

  test("badges the boards the work landed on, never the one you're looking at", () => {
    useCanvas.getState().recordActivity(event({ ts: 999, target: { screenId: "home" } }));
    // "other" also hosts home, so it earns a badge; "main" is visible.
    expect(useCanvas.getState().boardPulse).toEqual({ other: 999 });
  });

  test("trusts the server's hosting-board list for boards not loaded yet", () => {
    useCanvas
      .getState()
      .recordActivity(event({ ts: 42, target: { screenId: "unloaded", boards: ["archive"] } }));
    expect(useCanvas.getState().boardPulse).toEqual({ archive: 42 });
  });

  test("a batch cues every op it grouped, not just the envelope", () => {
    useCanvas.getState().recordActivity(
      event({
        verb: "batch",
        opCount: 2,
        target: {},
        ops: [
          { verb: "update_props", target: { screenId: "home", path: [0] } },
          { verb: "update_frame", target: { frameId: "f3" } },
        ],
      }),
    );
    expect(useCanvas.getState().activityFlash.home?.path).toBe("0");
    expect(useCanvas.getState().frameGlow).toEqual({ f3: 1 });
  });

  test("marks when the agent was last seen, for the indicator pulse", () => {
    expect(useCanvas.getState().lastAgentActivityAt).toBeNull();
    useCanvas.getState().recordActivity(event({ target: { screenId: "home" } }));
    expect(useCanvas.getState().lastAgentActivityAt).toBeGreaterThan(0);
  });
});

describe("backfillActivity", () => {
  const respond = (events: unknown[], status = 200) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ events }), {
        status,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  };

  test("merges the server's backlog under live entries and orders by id", async () => {
    useCanvas.setState({ activityEvents: [event({ id: 5, verb: "live" })] });
    respond([
      { id: 3, ts: 1, verb: "older", source: "mcp", target: {} },
      { id: 4, ts: 2, verb: "middle", source: "mcp", target: {} },
    ]);
    await useCanvas.getState().backfillActivity();
    expect(useCanvas.getState().activityEvents.map((e) => e.verb)).toEqual([
      "older",
      "middle",
      "live",
    ]);
  });

  test("never double-counts an entry the WS already delivered", async () => {
    useCanvas.setState({ activityEvents: [event({ id: 7, verb: "live" })] });
    respond([{ id: 7, ts: 1, verb: "same-event-from-http", source: "mcp", target: {} }]);
    await useCanvas.getState().backfillActivity();
    expect(useCanvas.getState().activityEvents.map((e) => e.verb)).toEqual(["live"]);
  });

  test("drops malformed backlog rows instead of poisoning the feed", async () => {
    respond([{ id: 1, ts: 1, verb: "good", source: "mcp", target: {} }, { nonsense: true }, null]);
    await useCanvas.getState().backfillActivity();
    expect(useCanvas.getState().activityEvents.map((e) => e.verb)).toEqual(["good"]);
  });

  test("is best-effort: a failing or non-ok endpoint leaves the feed alone", async () => {
    useCanvas.setState({ activityEvents: [event({ id: 1, verb: "live" })] });
    respond([{ id: 2, ts: 1, verb: "ignored", source: "mcp", target: {} }], 503);
    await useCanvas.getState().backfillActivity();
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    await useCanvas.getState().backfillActivity();
    expect(useCanvas.getState().activityEvents.map((e) => e.verb)).toEqual(["live"]);
  });

  test("opening the feed pulls the backlog; closing it doesn't", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    useCanvas.getState().setActivityFeedOpen(true);
    expect(useCanvas.getState().activityFeedOpen).toBe(true);
    useCanvas.getState().setActivityFeedOpen(false);
    await Bun.sleep(5);
    expect(calls).toBe(1);
  });
});
