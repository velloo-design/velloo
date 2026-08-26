import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDesignFolder,
  pinnedThemeForScreen,
  reloadScreen,
  reloadTheme,
  themeByName,
} from "../design-folder.ts";

const config = {
  schemaVersion: 1,
  toolVersion: "test",
  library: {
    id: "shadcn-react",
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const theme = {
  name: "test",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const screen = { id: "landing", name: "Landing", tree: { $ref: "Card" } };

let tmp: string;

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function scaffold(): Promise<void> {
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design", "config.json"), config);
  await writeJson(join(tmp, "theme", "default.json"), theme);
  await writeJson(join(tmp, "screens", "landing.json"), screen);
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-df-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await scaffold();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("loadDesignFolder", () => {
  test("loads config, theme, and screens; missing optional dirs default empty", async () => {
    const folder = await loadDesignFolder(tmp);
    expect(folder.config.toolVersion).toBe("test");
    expect(folder.theme.name).toBe("test");
    expect(folder.screens.get("landing")?.name).toBe("Landing");
    expect(folder.boards.size).toBe(0);
    expect(folder.snippets.size).toBe(0);
    expect(folder.history.depths()).toEqual({ undo: 0, redo: 0 });
  });

  test("a schema-invalid screen fails the load with a parse error", async () => {
    await writeJson(join(tmp, "screens", "broken.json"), { id: "broken", name: "" });
    await expect(loadDesignFolder(tmp)).rejects.toThrow();
  });

  test("an unparseable config fails the load", async () => {
    await writeFile(join(tmp, ".design", "config.json"), "{ not json", "utf8");
    await expect(loadDesignFolder(tmp)).rejects.toThrow();
  });
});

describe("reloadScreen", () => {
  test("picks up on-disk edits in place", async () => {
    const folder = await loadDesignFolder(tmp);
    await writeJson(join(tmp, "screens", "landing.json"), { ...screen, name: "Renamed" });
    const reloaded = await reloadScreen(folder, "landing");
    expect(reloaded?.name).toBe("Renamed");
    expect(folder.screens.get("landing")?.name).toBe("Renamed");
  });

  test("a deleted file evicts the cache entry and returns null", async () => {
    const folder = await loadDesignFolder(tmp);
    await rm(join(tmp, "screens", "landing.json"));
    const reloaded = await reloadScreen(folder, "landing");
    expect(reloaded).toBeNull();
    expect(folder.screens.has("landing")).toBe(false);
  });

  test("corrupted JSON throws (so the server can broadcast reload-error) and keeps the cached copy", async () => {
    const folder = await loadDesignFolder(tmp);
    await writeFile(join(tmp, "screens", "landing.json"), "{ nope", "utf8");
    await expect(reloadScreen(folder, "landing")).rejects.toThrow();
    expect(folder.screens.get("landing")?.name).toBe("Landing");
  });

  test("a schema-invalid edit throws and keeps the cached copy", async () => {
    const folder = await loadDesignFolder(tmp);
    await writeJson(join(tmp, "screens", "landing.json"), { id: "landing" });
    await expect(reloadScreen(folder, "landing")).rejects.toThrow();
    expect(folder.screens.get("landing")?.tree).toEqual({ $ref: "Card" });
  });
});

describe("reloadTheme", () => {
  test("picks up token edits", async () => {
    const folder = await loadDesignFolder(tmp);
    await writeJson(join(tmp, "theme", "default.json"), { ...theme, name: "edited" });
    await reloadTheme(folder);
    expect(folder.theme.name).toBe("edited");
  });
});

describe("named themes", () => {
  test("theme/*.json load into folder.themes with default aliased", async () => {
    await writeJson(join(tmp, "theme", "midnight.json"), { ...theme, name: "midnight" });
    const folder = await loadDesignFolder(tmp);
    expect([...folder.themes.keys()].sort()).toEqual(["default", "midnight"]);
    expect(folder.themes.get("default")).toBe(folder.theme);
    expect(themeByName(folder, "midnight").name).toBe("midnight");
  });

  test("themeByName falls back to default for unknown/absent names", async () => {
    const folder = await loadDesignFolder(tmp);
    expect(themeByName(folder, undefined)).toBe(folder.theme);
    expect(themeByName(folder, "ghost")).toBe(folder.theme);
  });

  test("reloadTheme refreshes the named map", async () => {
    const folder = await loadDesignFolder(tmp);
    await writeJson(join(tmp, "theme", "neon.json"), { ...theme, name: "neon" });
    await reloadTheme(folder);
    expect(themeByName(folder, "neon").name).toBe("neon");
  });
});

describe("pinnedThemeForScreen", () => {
  function board(id: string, screens: string[], boardTheme?: string) {
    return {
      id,
      name: id,
      ...(boardTheme ? { theme: boardTheme } : {}),
      frames: screens.map((s, i) => ({
        id: `f-${id}-${i}`,
        screen: s,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
      })),
      groups: [],
    };
  }

  test("a single hosting board's pin wins; unhosted screens fall to default", async () => {
    await mkdir(join(tmp, "boards"), { recursive: true });
    await writeJson(join(tmp, "boards", "a.json"), board("a", ["landing"], "midnight"));
    const folder = await loadDesignFolder(tmp);
    expect(pinnedThemeForScreen(folder, "landing")).toEqual({ ok: true, name: "midnight" });
    expect(pinnedThemeForScreen(folder, "elsewhere")).toEqual({ ok: true, name: undefined });
  });

  test("agreeing boards resolve; an unpinned host resolves to the default", async () => {
    await mkdir(join(tmp, "boards"), { recursive: true });
    await writeJson(join(tmp, "boards", "a.json"), board("a", ["landing"], "midnight"));
    await writeJson(join(tmp, "boards", "b.json"), board("b", ["landing"], "midnight"));
    await writeJson(join(tmp, "boards", "c.json"), board("c", ["signup"]));
    const folder = await loadDesignFolder(tmp);
    expect(pinnedThemeForScreen(folder, "landing")).toEqual({ ok: true, name: "midnight" });
    expect(pinnedThemeForScreen(folder, "signup")).toEqual({ ok: true, name: undefined });
  });

  test("boards disagreeing (including an unpinned host) is an error naming each side", async () => {
    await mkdir(join(tmp, "boards"), { recursive: true });
    await writeJson(join(tmp, "boards", "a.json"), board("a", ["landing"], "midnight"));
    await writeJson(join(tmp, "boards", "b.json"), board("b", ["landing"]));
    const folder = await loadDesignFolder(tmp);
    const res = pinnedThemeForScreen(folder, "landing");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain('"midnight" (a)');
      expect(res.message).toContain('"default" (b)');
    }
  });
});
