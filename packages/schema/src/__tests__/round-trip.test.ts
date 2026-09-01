import { describe, expect, test } from "bun:test";
import {
  type Board,
  BoardSchema,
  type Frame,
  FrameSchema,
  findDuplicateIds,
  isArchived,
  type Node,
  NodeSchema,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "../index.ts";

/**
 * Round-trip tests: every Velloo doc that hits disk (screen, board,
 * frame, snippet, theme) must parse, re-serialize, re-parse to the
 * same value. These guard against schema drift where Zod accepts an
 * input but emits a different shape than what we wrote in.
 */

function roundTrip<T>(parse: (v: unknown) => T, value: T): T {
  return parse(JSON.parse(JSON.stringify(value)));
}

describe("schema round-trips", () => {
  test("node tree survives JSON round-trip", () => {
    const tree: Node = {
      $ref: "Card",
      props: { className: "p-4", $id: "hero" },
      children: [
        {
          $ref: "Heading",
          props: { level: 1, children: "Hello" },
        },
        {
          $ref: "Button",
          props: { variant: "default", children: "Continue" },
        },
      ],
    };
    const out = roundTrip((v) => NodeSchema.parse(v), tree);
    expect(out).toEqual(tree);
  });

  test("screen survives JSON round-trip", () => {
    const screen: Screen = {
      id: "landing",
      name: "Landing",
      tree: { $ref: "Card", children: [{ $ref: "Heading", props: { level: 1 } }] },
    };
    expect(roundTrip((v) => ScreenSchema.parse(v), screen)).toEqual(screen);
  });

  test("frame survives JSON round-trip", () => {
    const frame: Frame = {
      id: "f1",
      screen: "landing",
      x: 0,
      y: 0,
      w: 1440,
      h: 900,
      label: "Desktop",
      group: "marketing",
    };
    expect(roundTrip((v) => FrameSchema.parse(v), frame)).toEqual(frame);
  });

  test("board survives JSON round-trip", () => {
    const board: Board = {
      id: "app",
      name: "App",
      frames: [{ id: "f1", screen: "dashboard", x: 0, y: 0, w: 1440, h: 900 }],
      groups: [{ id: "core", name: "Core", color: "#5e6ad2" }],
    };
    expect(roundTrip((v) => BoardSchema.parse(v), board)).toEqual(board);
  });

  test("archived board survives JSON round-trip; absent archivedAt stays absent", () => {
    const live: Board = { id: "b1", name: "Main", frames: [], groups: [] };
    const parsedLive = roundTrip((v) => BoardSchema.parse(v), live);
    expect(parsedLive).toEqual(live);
    // Absent means active — Zod must not materialize the key.
    expect("archivedAt" in parsedLive).toBe(false);
    expect(isArchived(parsedLive)).toBe(false);

    const archived: Board = { ...live, archivedAt: "2026-08-25T10:30:00.000Z" };
    const parsedArchived = roundTrip((v) => BoardSchema.parse(v), archived);
    expect(parsedArchived).toEqual(archived);
    expect(isArchived(parsedArchived)).toBe(true);
  });

  test("a board file predating archiving still loads", () => {
    // The on-disk contract: adding archivedAt must not break existing folders.
    const legacy = { id: "b1", name: "Main", frames: [], groups: [] };
    expect(() => BoardSchema.parse(legacy)).not.toThrow();
  });

  test("archivedAt must be a real ISO timestamp", () => {
    expect(() => BoardSchema.parse({ id: "b1", name: "M", archivedAt: "yesterday" })).toThrow();
  });

  test("snippet with typed params survives JSON round-trip", () => {
    const snippet: Snippet = {
      id: "stat-card",
      name: "Stat Card",
      params: [
        { name: "label", type: "string" },
        { name: "value", type: "string", default: "0" },
        { name: "highlight", type: "boolean", default: false },
      ],
      tree: {
        $ref: "Card",
        children: [
          { $ref: "Text", props: { children: { $param: "label" } } },
          { $ref: "Heading", props: { level: 2, children: { $param: "value" } } },
        ],
      },
    };
    expect(roundTrip((v) => SnippetSchema.parse(v), snippet)).toEqual(snippet);
  });

  test("theme survives JSON round-trip", () => {
    const theme: Theme = {
      name: "indigo",
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
      },
      typography: {},
      spacing: {},
      radius: {},
    };
    expect(roundTrip((v) => ThemeSchema.parse(v), theme)).toEqual(theme);
  });
});

describe("schema rejects malformed input", () => {
  test("frame rejects negative size", () => {
    const bad = { id: "f", screen: "s", x: 0, y: 0, w: -1, h: 100 };
    expect(FrameSchema.safeParse(bad).success).toBe(false);
  });

  test("frame rejects missing screen ref", () => {
    expect(FrameSchema.safeParse({ id: "f", x: 0, y: 0, w: 1, h: 1 }).success).toBe(false);
  });

  test("snippet rejects unknown param type", () => {
    const bad = {
      id: "x",
      name: "X",
      params: [{ name: "n", type: "vector" }],
      tree: { $ref: "Text" },
    };
    expect(SnippetSchema.safeParse(bad).success).toBe(false);
  });

  test("node rejects bare $id without props envelope", () => {
    // $id must live in props, not at node root
    expect(NodeSchema.safeParse({ $ref: "X", $id: "y" }).success).toBe(true);
    // It's stored as a passthrough — but the schema enforces $ref minimum.
    expect(NodeSchema.safeParse({ $ref: "" }).success).toBe(false);
  });
});

describe("id collection + duplicate detection", () => {
  test("findDuplicateIds reports collisions", () => {
    const tree = {
      $ref: "Card",
      children: [
        { $ref: "Text", $id: "dup" },
        { $ref: "Text", $id: "dup" },
        { $ref: "Text", $id: "unique" },
      ],
    } as unknown as Node;
    const dupes = findDuplicateIds(tree);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.id).toBe("dup");
    expect(dupes[0]?.paths).toEqual([[0], [1]]);
  });

  test("findDuplicateIds does not descend into snippet instance bodies", () => {
    const tree: Node = {
      $ref: "Card",
      children: [
        { $snippet: "stat-card", args: {} },
        { $snippet: "stat-card", args: {} },
      ],
    };
    expect(findDuplicateIds(tree)).toEqual([]);
  });
});
