import { describe, expect, test } from "bun:test";
import type { Screen, Snippet, Theme } from "@velloo/schema";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import { findSnippetInstances } from "../snippet-instances.ts";

/**
 * Synthetic DesignFolder fixtures — the walker is pure so we don't need
 * to scaffold a real folder on disk. Tests pin the contract:
 *  - root tree instances are found
 *  - nested instances are found with their path
 *  - snippet-body instances surface with "snippet:" prefix
 *  - `$extraClassName` instances are flagged hasOverride: true
 */

function blankTheme(): Theme {
  return {
    name: "t",
    colors: {
      background: "#fff",
      foreground: "#000",
      primary: { DEFAULT: "#000", foreground: "#fff" },
      secondary: { DEFAULT: "#eee", foreground: "#000" },
      muted: { DEFAULT: "#eee", foreground: "#000" },
      accent: { DEFAULT: "#eee", foreground: "#000" },
      destructive: { DEFAULT: "#f00", foreground: "#fff" },
      card: { DEFAULT: "#fff", foreground: "#000" },
      popover: { DEFAULT: "#fff", foreground: "#000" },
      border: "#ccc",
      input: "#ccc",
      ring: "#999",
    },
    typography: {},
    spacing: {},
    radius: {},
  };
}

function makeFolder(screens: Screen[], snippets: Snippet[]): DesignFolder {
  return {
    root: "/tmp",
    config: {
      schemaVersion: 1,
      toolVersion: "test",
      library: {
        id: "shadcn-react",
        version: "test",
        source: "embedded:shadcn",
        componentsPath: "embedded:shadcn",
      },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    },
    theme: blankTheme(),
    history: new HistoryManager(),
    screens: new Map(screens.map((s) => [s.id, s])),
    boards: new Map(),
    snippets: new Map(snippets.map((s) => [s.id, s])),
    annotations: new Map(),
    notes: new Map(),
  };
}

describe("findSnippetInstances", () => {
  test("returns [] for a snippet with no usages", () => {
    const folder = makeFolder(
      [
        {
          id: "landing",
          name: "Landing",
          tree: { $ref: "Card", children: [{ $ref: "Heading", props: { level: 1 } }] },
        },
      ],
      [
        {
          id: "stat-card",
          name: "Stat Card",
          params: [],
          tree: { $ref: "Card" },
        },
      ],
    );
    expect(findSnippetInstances(folder, "stat-card")).toEqual([]);
  });

  test("finds an instance at the screen root", () => {
    const folder = makeFolder(
      [
        {
          id: "dashboard",
          name: "Dashboard",
          tree: { $snippet: "stat-card", args: {} },
        },
      ],
      [{ id: "stat-card", name: "Stat Card", params: [], tree: { $ref: "Card" } }],
    );
    const locs = findSnippetInstances(folder, "stat-card");
    expect(locs).toHaveLength(1);
    expect(locs[0]).toEqual({ screenId: "dashboard", path: "", hasOverride: false });
  });

  test("finds nested instances at their dotted path", () => {
    const folder = makeFolder(
      [
        {
          id: "dashboard",
          name: "Dashboard",
          tree: {
            $ref: "Card",
            children: [
              { $ref: "Heading", props: { level: 1 } },
              {
                $ref: "Card",
                children: [{ $snippet: "stat-card", args: {} }],
              },
            ],
          },
        },
      ],
      [{ id: "stat-card", name: "Stat Card", params: [], tree: { $ref: "Card" } }],
    );
    const locs = findSnippetInstances(folder, "stat-card");
    expect(locs).toHaveLength(1);
    expect(locs[0]?.path).toBe("1.0");
  });

  test("flags instances carrying $extraClassName", () => {
    const folder = makeFolder(
      [
        {
          id: "x",
          name: "X",
          tree: {
            $ref: "Card",
            children: [
              { $snippet: "stat-card", args: {} },
              { $snippet: "stat-card", args: {}, $extraClassName: "border-2 ring-2 ring-primary" },
            ],
          },
        },
      ],
      [{ id: "stat-card", name: "Stat Card", params: [], tree: { $ref: "Card" } }],
    );
    const locs = findSnippetInstances(folder, "stat-card");
    expect(locs).toHaveLength(2);
    expect(locs.filter((l) => l.hasOverride)).toHaveLength(1);
    expect(locs.find((l) => l.hasOverride)?.path).toBe("1");
  });

  test("descends into other snippet bodies and labels them with `snippet:` prefix", () => {
    const folder = makeFolder(
      [],
      [
        { id: "atom", name: "Atom", params: [], tree: { $ref: "Card" } },
        {
          id: "molecule",
          name: "Molecule",
          params: [],
          tree: {
            $ref: "Card",
            children: [{ $snippet: "atom", args: {} }],
          },
        },
      ],
    );
    const locs = findSnippetInstances(folder, "atom");
    expect(locs).toHaveLength(1);
    expect(locs[0]?.screenId).toBe("snippet:molecule");
  });

  test("doesn't descend into a snippet body that is itself the snippet being searched", () => {
    // If "stat-card" recursively embedded itself, we'd loop. The walker
    // skips the searched snippet's own body so it's safe.
    const folder = makeFolder(
      [],
      [
        {
          id: "stat-card",
          name: "Stat Card",
          params: [],
          tree: { $ref: "Card", children: [{ $snippet: "stat-card", args: {} }] },
        },
      ],
    );
    const locs = findSnippetInstances(folder, "stat-card");
    expect(locs).toEqual([]);
  });
});
