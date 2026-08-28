import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import {
  ACTIVITY_LOG_CAP,
  type ActivityEvent,
  activityLog,
  clearActivityLogForTest,
  collectActivity,
  emitActivity,
  emitGroupedActivity,
  GROUP_DETAIL_CAP,
  withActor,
} from "../activity.ts";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { updateProps } from "../mutations/api/tree.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import type { WatchEvent } from "../watcher.ts";

const provider = createShadcnProvider();

/**
 * Activity events ride the WS channel alongside (never instead of)
 * WatchEvents — verb, resolved target, source attribution via
 * AsyncLocalStorage, session id, timestamp; grouped bursts; the bounded ring
 * buffer behind GET /api/activity; and silence on failures and pure reads.
 */

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

const activityEvents = () => events.filter((e): e is ActivityEvent => e.type === "activity");
const watchEvents = () => events.filter((e) => e.type !== "activity");

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig));
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme));
  await writeFile(
    join(tmp, "screens/home.json"),
    JSON.stringify({
      id: "home",
      name: "Home",
      tree: { $ref: "Box", children: [{ $ref: "Text", props: { children: "hi" } }] },
    }),
  );
  await writeFile(
    join(tmp, "boards/main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      frames: [{ id: "f1", screen: "home", x: 0, y: 0, w: 400, h: 300 }],
      groups: [],
    }),
  );
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  clearActivityLogForTest(tmp);
  await rm(tmp, { recursive: true, force: true });
});

describe("activity emission", () => {
  test("a node mutation emits verb + resolved path + actor, ALONGSIDE the WatchEvent", async () => {
    const before = Date.now();
    const r = await withActor({ source: "mcp", session: "sess-1234" }, () =>
      updateProps(ctx, { screenId: "home", path: [0], propPatch: { className: "p-2" } }),
    );
    expect(r.ok).toBe(true);

    // The refresh mechanism is untouched: screen-changed still broadcast.
    expect(watchEvents().some((e) => e.type === "screen-changed")).toBe(true);

    const [event] = activityEvents();
    if (!event) throw new Error("no activity event emitted");
    expect(event.verb).toBe("update_props");
    expect(event.source).toBe("mcp");
    expect(event.session).toBe("sess-1234");
    // `boards` is server-enriched: the canvas can't map screen → unloaded board.
    expect(event.target).toEqual({ screenId: "home", path: [0], boards: ["main"] });
    expect(event.ts).toBeGreaterThanOrEqual(before);
    // And it landed in the backfill ring too.
    expect(activityLog(tmp).some((e) => e.id === event.id)).toBe(true);
  });

  test("no actor context defaults to source cli; canvas route tags source canvas", async () => {
    await updateProps(ctx, { screenId: "home", path: [0], propPatch: { className: "m-1" } });
    expect(activityEvents()[0]?.source).toBe("cli");

    const jit = new TailwindJit(provider, join(folder.root, "screens"));
    const bundler = new LiveBundler(
      folder.root,
      () => folder.config,
      () => liveExtensions(folder.config.extensions),
    );
    const canvasBundler = new CanvasBundler(
      folder.root,
      () => folder.config.hostApp,
      () => undefined,
    );
    const app = createApp(() => ctx, jit, bundler, canvasBundler);
    const res = await app.fetch(
      new Request("http://localhost/api/mutate/update_props", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenId: "home", path: [0], propPatch: { className: "m-2" } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(activityEvents().at(-1)?.source).toBe("canvas");

    // Pure reads emit nothing: a GET leaves the log where it was.
    const count = activityLog(tmp).length;
    await app.fetch(new Request("http://localhost/api/screen/home"));
    const backfill = await app.fetch(new Request("http://localhost/api/activity"));
    expect(activityLog(tmp).length).toBe(count);
    // ...and /api/activity serves the ring for canvas backfill.
    const body = (await backfill.json()) as { events: ActivityEvent[] };
    expect(body.events.length).toBe(count);
    expect(body.events.at(-1)?.verb).toBe("update_props");
  });

  test("a failed mutation emits nothing", async () => {
    const r = await updateProps(ctx, {
      screenId: "no-such-screen",
      path: [0],
      propPatch: { className: "x" },
    });
    expect(r.ok).toBe(false);
    expect(activityEvents().length).toBe(0);
  });

  test("bursts group into one event with per-op detail, capped", async () => {
    const { ops } = await collectActivity(async () => {
      for (let i = 0; i < GROUP_DETAIL_CAP + 5; i++) {
        emitActivity(ctx, "update_props", { screenId: "home", path: [0] });
      }
    });
    // Collected, not published: nothing broadcast yet.
    expect(activityEvents().length).toBe(0);
    emitGroupedActivity(ctx, "batch", ops);
    const grouped = activityEvents();
    expect(grouped.length).toBe(1);
    expect(grouped[0]?.verb).toBe("batch");
    expect(grouped[0]?.ops?.length).toBe(GROUP_DETAIL_CAP);
    expect(grouped[0]?.opCount).toBe(GROUP_DETAIL_CAP + 5);
  });

  test("the ring buffer is bounded", () => {
    for (let i = 0; i < ACTIVITY_LOG_CAP + 30; i++) {
      emitActivity(ctx, "set_token", { token: `colors.c${i}` });
    }
    const log = activityLog(tmp);
    expect(log.length).toBe(ACTIVITY_LOG_CAP);
    // Oldest entries were evicted; the newest survived.
    expect(log.at(-1)?.target.token).toBe(`colors.c${ACTIVITY_LOG_CAP + 29}`);
  });
});
