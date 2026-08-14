import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import {
  applyPreset,
  derivePaletteFromColor,
  matchVibe,
  setToken,
  type ThemeContext,
} from "../index.ts";

const sampleConfig = {
  schemaVersion: 1,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "registry:shadcn",
    componentsPath: "components/ui",
  },
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
let events: WatchEvent[];

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
    expect(events.at(-1)).toEqual({ type: "theme-changed" });
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
    expect(events.at(-1)).toEqual({ type: "theme-changed" });
  });

  test("rejects a path that produces an invalid theme", async () => {
    const r = await setToken(ctx, "colors.primary.DEFAULT", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidThemePath");
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
});

describe("matchVibe", () => {
  test("playful → warm seed, persisted", async () => {
    const r = unwrap(await matchVibe(ctx, "playful and joyful"));
    expect(r.matched.source).toBe("heuristic");
    expect(r.matched.keywords).toContain("playful");
    const onDisk = await diskTheme();
    expect(typeof onDisk.colors.primary).toBe("object");
  });

  test("garbage description falls back gracefully", async () => {
    const r = unwrap(await matchVibe(ctx, "blorflexicon"));
    expect(r.matched.source).toBe("heuristic");
    // Theme was still updated to something.
    expect(r.theme.colors.primary).toBeDefined();
  });
});
