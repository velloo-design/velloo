import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import {
  applyPreset,
  derivePaletteFromColor,
  setToken,
  setTokens,
  type ThemeContext,
  withThemeLock,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 2,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "components/ui",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
};
const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};
const sampleScreen = {
  id: "onboarding",
  name: "Onboarding",
  tree: { $ref: "Card", children: [{ $ref: "Heading", props: { level: 1 } }] },
};

let tmp: string;
let folder: DesignFolder;
let ctx: ThemeContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function diskTheme(): Promise<Theme> {
  return JSON.parse(await readFile(join(tmp, "theme/default.json"), "utf8")) as Theme;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-theme-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/onboarding.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = { folder, broadcast: (e) => events.push(e) };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("applyPreset", () => {
  test("switches to violet and persists", async () => {
    const t = unwrap(await applyPreset(ctx, "violet"));
    expect(t.name).toBe("violet");
    const onDisk = await diskTheme();
    expect(onDisk.name).toBe("violet");
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({
      type: "theme-changed",
    });
  });

  test("returns UnknownPreset err on unknown preset", async () => {
    const r = await applyPreset(ctx, "neonpunk");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("UnknownPreset");
  });
});

describe("setToken", () => {
  test("updates a leaf and persists", async () => {
    unwrap(await setToken(ctx, "colors.background", "oklch(0.99 0 0)"));
    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("oklch(0.99 0 0)");
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({
      type: "theme-changed",
    });
  });

  test("rejects a path that produces an invalid theme", async () => {
    const r = await setToken(ctx, "colors.primary.DEFAULT", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidThemePath");
  });
});

describe("setTokens (bulk)", () => {
  test("applies every entry with one persist and one broadcast", async () => {
    const r = unwrap(
      await setTokens(ctx, [
        { path: "colors.background", value: "oklch(0.98 0 0)" },
        { path: "colors.foreground", value: "oklch(0.2 0 0)" },
        { path: "colors.primary.foreground", value: "oklch(0.99 0 0)" },
      ]),
    );
    expect(r.applied).toEqual([
      "colors.background",
      "colors.foreground",
      "colors.primary.foreground",
    ]);
    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("oklch(0.98 0 0)");
    expect(onDisk.colors.foreground).toBe("oklch(0.2 0 0)");
    // The whole batch broadcast exactly once, not per entry (one WatchEvent
    // + one additive activity event).
    expect(events.filter((e) => e.type !== "activity")).toEqual([{ type: "theme-changed" }]);
  });

  test("any bad entry fails the batch with a per-entry report and persists nothing", async () => {
    const before = await diskTheme();
    const r = await setTokens(ctx, [
      { path: "colors.background", value: "oklch(0.5 0 0)" },
      { path: "colors.primary.DEFAULT", value: "" },
      { path: "", value: "x" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "BulkTokensInvalid") {
      expect(r.error.applied).toEqual(["colors.background"]);
      expect(r.error.failed.map((f) => f.path)).toEqual(["colors.primary.DEFAULT", ""]);
      expect(r.error.failed[0]?.reason).toContain("colors.primary.DEFAULT");
    } else if (!r.ok) {
      throw new Error(`expected BulkTokensInvalid, got ${r.error.kind}`);
    }
    // All-or-nothing: the valid first entry did NOT land on disk, and no
    // theme-changed event fired.
    expect(await diskTheme()).toEqual(before);
    expect(events).toEqual([]);
  });
});

describe("withThemeLock", () => {
  test("two folders do not share a theme lock chain", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = withThemeLock({ root: "/tmp/velloo-theme-lock-a" }, () => gate);
    // Would deadlock (until the test timeout) if both folders chained on one lock.
    const other = await withThemeLock({ root: "/tmp/velloo-theme-lock-b" }, async () => "ran");
    expect(other).toBe("ran");
    release();
    await held;
  });
});

describe("derivePaletteFromColor", () => {
  test("violet seed produces a violet theme; primary becomes a violet OKLCH", async () => {
    const r = unwrap(await derivePaletteFromColor(ctx, "#7c3aed"));
    const primary = r.theme.colors.primary;
    expect(typeof primary).toBe("object");
    if (typeof primary === "object") {
      expect(primary.DEFAULT).toContain("oklch");
    }
    const onDisk = await diskTheme();
    expect(onDisk.colors.primary).toEqual(primary as never);
  });

  test("a named derive writes theme/<name>.json and never touches the default", async () => {
    const before = await diskTheme();
    const r = unwrap(await derivePaletteFromColor(ctx, "#7c3aed", "brand"));
    expect(r.theme.name).toBe("brand");

    const named = JSON.parse(await readFile(join(tmp, "theme/brand.json"), "utf8")) as Theme;
    expect(named.name).toBe("brand");
    expect(named.colors.primary).toEqual(r.theme.colors.primary as never);

    // The default theme — on disk and in memory — is untouched.
    expect(await diskTheme()).toEqual(before);
    expect(folder.theme.name).toBe("default");
    expect(folder.themes.get("brand")).toBeDefined();
  });
});

describe("named-theme clone-on-write", () => {
  test("setToken on a missing named theme creates it with its own name, not 'default'", async () => {
    unwrap(await setToken(ctx, "colors.background", "oklch(0.2 0 0)", "midnight"));
    const named = JSON.parse(await readFile(join(tmp, "theme/midnight.json"), "utf8")) as Theme;
    expect(named.name).toBe("midnight");
    expect(named.colors.background).toBe("oklch(0.2 0 0)");
    // Clone-on-write: the default is the base but stays unchanged.
    expect((await diskTheme()).colors.background).toBe("oklch(1 0 0)");
  });
});
