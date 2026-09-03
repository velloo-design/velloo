import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Config, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { createConfigRouter } from "../../routes/design.ts";
import { createMutateRouter } from "../../routes/mutate.ts";
import type { WatchEvent } from "../../watcher.ts";
import {
  type MutationContext,
  updateCodegen,
  updateDefaults,
  updateFeedback,
  updateViewportPresets,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: { id: "shadcn-upstream", version: "test", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "default",
  viewportPresets: [
    { name: "Mobile", w: 390, h: 844 },
    { name: "Desktop", w: 1440, h: 900 },
  ],
};

const provider = createShadcnProvider();

const sampleTheme: Theme = {
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
/** Machine-level prefs, redirected per test so the suite never touches ~/.velloo. */
let prefsPath: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** The config as it actually landed on disk, not the in-memory copy. */
async function onDisk(): Promise<Config> {
  return JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")) as Config;
}

const broadcasts = () => events.filter((e) => e.type !== "activity");

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  prefsPath = join(tmp, "prefs.json");
  process.env.VELLOO_PREFS_PATH = prefsPath;
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "theme/candidate.json"), { ...sampleTheme, name: "candidate" });
  await writeJson(join(tmp, "screens/home.json"), {
    id: "home",
    name: "Home",
    tree: { $ref: "Box", props: {}, children: [] },
  });
  await writeJson(join(tmp, "boards/main.json"), {
    id: "main",
    name: "Main",
    frames: [{ id: "f1", screen: "home", x: 0, y: 0, w: 1440, h: 900 }],
    groups: [],
  });
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
  process.env.VELLOO_PREFS_PATH = undefined;
  await rm(tmp, { recursive: true, force: true });
});

describe("update_viewport_presets", () => {
  test("replaces the list, persists, and broadcasts config-changed", async () => {
    const presets = [
      { name: "Phone", w: 393, h: 852 },
      { name: "Wide", w: 1920, h: 1080 },
    ];
    expect(unwrap(await updateViewportPresets(ctx, { presets })).presets).toEqual(presets);
    expect((await onDisk()).viewportPresets).toEqual(presets);
    expect(broadcasts()).toEqual([{ type: "config-changed" }]);
  });

  test("trims names and rejects a duplicate", async () => {
    unwrap(await updateViewportPresets(ctx, { presets: [{ name: "  Phone  ", w: 390, h: 844 }] }));
    expect((await onDisk()).viewportPresets).toEqual([{ name: "Phone", w: 390, h: 844 }]);

    const dup = await updateViewportPresets(ctx, {
      presets: [
        { name: "Phone", w: 390, h: 844 },
        { name: "phone", w: 400, h: 800 },
      ],
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.kind).toBe("BadRequest");
    // The refused write left the trimmed single-preset list untouched.
    expect((await onDisk()).viewportPresets).toHaveLength(1);
  });

  test("rejects an empty list and a non-positive size", async () => {
    const empty = await updateViewportPresets(ctx, { presets: [] });
    expect(empty.ok).toBe(false);
    const zero = await updateViewportPresets(ctx, { presets: [{ name: "Zero", w: 0, h: 900 }] });
    expect(zero.ok).toBe(false);
    expect((await onDisk()).viewportPresets).toEqual(sampleConfig.viewportPresets);
  });

  test("leaves existing frames alone", async () => {
    await updateViewportPresets(ctx, { presets: [{ name: "Phone", w: 390, h: 844 }] });
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.boards.get("main")?.frames[0]).toMatchObject({ w: 1440, h: 900 });
  });
});

describe("update_defaults", () => {
  test("sets each independently and clears with null", async () => {
    unwrap(await updateDefaults(ctx, { defaultBoard: "main" }));
    unwrap(await updateDefaults(ctx, { defaultScreen: "home" }));
    expect(await onDisk()).toMatchObject({ defaultBoard: "main", defaultScreen: "home" });

    // Writing one must not disturb the other.
    const cleared = unwrap(await updateDefaults(ctx, { defaultBoard: null }));
    expect(cleared).toEqual({ defaultBoard: null, defaultScreen: "home" });
    expect(await onDisk()).not.toHaveProperty("defaultBoard");
  });

  test("rejects ids that don't resolve", async () => {
    const board = await updateDefaults(ctx, { defaultBoard: "nope" });
    expect(board.ok).toBe(false);
    if (!board.ok) expect(board.error.kind).toBe("BoardNotFound");
    const screen = await updateDefaults(ctx, { defaultScreen: "nope" });
    if (!screen.ok) expect(screen.error.kind).toBe("ScreenNotFound");
    expect(await onDisk()).not.toHaveProperty("defaultBoard");
  });
});

describe("update_codegen", () => {
  test("sets, trims, and clears the alias", async () => {
    unwrap(await updateCodegen(ctx, { componentsAlias: "  ~/ui  " }));
    expect((await onDisk()).codegen).toEqual({ componentsAlias: "~/ui" });

    // Clearing drops the whole block rather than leaving `codegen: {}`.
    expect(unwrap(await updateCodegen(ctx, { componentsAlias: null })).componentsAlias).toBeNull();
    expect(await onDisk()).not.toHaveProperty("codegen");
  });

  test("rejects an all-whitespace alias", async () => {
    const result = await updateCodegen(ctx, { componentsAlias: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("BadRequest");
  });
});

describe("update_feedback", () => {
  test("the folder records whether the tool is on; contact consent stays off-repo", async () => {
    unwrap(await updateFeedback(ctx, { enabled: true, contactOk: true }));
    unwrap(await updateFeedback(ctx, { enabled: false }));
    // `contactOk` is the person's — it never lands in a committed file.
    expect((await onDisk()).feedback).toEqual({ enabled: false });
    expect(JSON.parse(await readFile(prefsPath, "utf8")).feedbackContactOk).toBe(true);
    // …and it still rides along in the result, read back from this machine.
    expect(unwrap(await updateFeedback(ctx, { enabled: true }))).toEqual({
      enabled: true,
      contactOk: true,
    });
  });
});

describe("HTTP surface", () => {
  test("GET /api/config reports the editable fields and the read-only facts", async () => {
    const app = createConfigRouter(() => ctx);
    const body = (await (await app.request("/")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      root: tmp,
      schemaVersion: 3,
      toolVersion: "0.1.0",
      defaultLibrary: "default",
      styling: null,
      componentsAlias: null,
      feedback: { enabled: false, contactOk: false },
      themes: ["default", "candidate"],
    });
    expect(body.libraries).toEqual([
      { id: "default", providerId: "shadcn-upstream", version: "test", source: "binary" },
    ]);
    // Never the raw config: extensions and host-app paths stay server-side.
    expect(body).not.toHaveProperty("extensions");
    expect(body).not.toHaveProperty("hostApp");
  });

  test("POST /api/mutate/update_viewport_presets writes through the route", async () => {
    const app = createMutateRouter(() => ctx);
    const res = await app.request("/update_viewport_presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presets: [{ name: "Phone", w: 390, h: 844 }] }),
    });
    expect(res.status).toBe(200);
    expect((await onDisk()).viewportPresets).toEqual([{ name: "Phone", w: 390, h: 844 }]);
  });

  test("a rejected mutation answers with its typed status and changes nothing", async () => {
    const app = createMutateRouter(() => ctx);
    const res = await app.request("/update_defaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultBoard: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(await onDisk()).not.toHaveProperty("defaultBoard");
  });
});
