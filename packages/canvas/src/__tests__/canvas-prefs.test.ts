import { describe, expect, test } from "bun:test";

/**
 * Canvas-scope preferences. The one that actually regressed before:
 * `designMode` was hardcoded to "light" at store creation, so a canvas left in
 * the dark preset came back light on every reload.
 *
 * Boot is tested through `readCanvasPrefs` — the function the store's initial
 * state is built from — rather than through the store itself, which evaluates
 * once per process and so can't be re-booted against a fresh stub. The write
 * paths read localStorage per call, so those drive the real store.
 */

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  has(key: string): boolean {
    return this.data.has(key);
  }
}

const storage = new MemoryStorage();
// Seeded as if the user last left the canvas in dark with panels collapsed.
storage.setItem("velloo:designMode", "dark");
storage.setItem("velloo:appTheme", "dark");
storage.setItem("velloo:leftPanels", JSON.stringify({ boards: true, tree: false }));
(globalThis as { localStorage?: unknown }).localStorage = storage;

const { useCanvas } = await import("../store.ts");
const { readCanvasPrefs } = await import("../store/modes.ts");

// The store may already have been created by another test file in this
// process, before the stub existed — re-seed it from what's stored now.
useCanvas.setState(readCanvasPrefs());

describe("canvas preferences at boot", () => {
  test("restores the design preset, app theme, and panel collapse", () => {
    const s = readCanvasPrefs();
    expect(s.designMode).toBe("dark");
    expect(s.appTheme).toBe("dark");
    expect(s.boardsCollapsed).toBe(true);
    expect(s.treeCollapsed).toBe(false);
    expect(s.rememberDesignMode).toBe(true);
    expect(s.rememberPanels).toBe(true);
  });
});

describe("designMode persistence", () => {
  test("writes the mode while remembering is on", () => {
    useCanvas.getState().setDesignMode("light");
    expect(storage.getItem("velloo:designMode")).toBe("light");
    useCanvas.getState().setDesignMode("dark");
    expect(storage.getItem("velloo:designMode")).toBe("dark");
  });

  test("turning remembering off drops the stored mode and stops writing it", () => {
    useCanvas.getState().setRememberDesignMode(false);
    expect(storage.has("velloo:designMode")).toBe(false);
    useCanvas.getState().setDesignMode("dark");
    expect(storage.has("velloo:designMode")).toBe(false);
  });

  test("turning it back on adopts the mode currently on screen", () => {
    useCanvas.getState().setDesignMode("dark");
    useCanvas.getState().setRememberDesignMode(true);
    expect(storage.getItem("velloo:designMode")).toBe("dark");
  });
});

describe("panel persistence", () => {
  test("collapse writes through only while remembering is on", () => {
    useCanvas.getState().setRememberPanels(false);
    expect(storage.has("velloo:leftPanels")).toBe(false);
    useCanvas.getState().toggleTreeCollapsed();
    expect(storage.has("velloo:leftPanels")).toBe(false);

    // Re-enabling captures the live state rather than waiting for the next toggle.
    useCanvas.getState().setRememberPanels(true);
    expect(JSON.parse(storage.getItem("velloo:leftPanels") as string)).toEqual({
      boards: useCanvas.getState().boardsCollapsed,
      tree: useCanvas.getState().treeCollapsed,
    });
  });
});

describe("resetCanvasPrefs", () => {
  test("clears every stored key and returns the store to defaults", () => {
    useCanvas.getState().setAppTheme("light");
    useCanvas.getState().setDesignMode("dark");
    useCanvas.getState().resetCanvasPrefs();

    for (const key of [
      "velloo:appTheme",
      "velloo:designMode",
      "velloo:rememberDesignMode",
      "velloo:leftPanels",
      "velloo:rememberPanels",
    ]) {
      expect(storage.has(key)).toBe(false);
    }
    const s = useCanvas.getState();
    expect(s.appTheme).toBe("system");
    expect(s.designMode).toBe("light");
    expect(s.rememberDesignMode).toBe(true);
    expect(s.rememberPanels).toBe(true);
    expect(s.boardsCollapsed).toBe(false);
  });
});

describe("settings dialog state", () => {
  test("opens on a scope and closes with null", () => {
    useCanvas.getState().setSettingsScope("board");
    expect(useCanvas.getState().settingsScope).toBe("board");
    useCanvas.getState().setSettingsScope(null);
    expect(useCanvas.getState().settingsScope).toBeNull();
  });
});
