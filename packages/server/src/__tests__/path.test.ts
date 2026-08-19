import { describe, expect, test } from "bun:test";
import type { Node } from "@velloo/schema";
import {
  coercePath,
  findById,
  isIdLocator,
  parentOf,
  pathAt,
  pathFromString,
  pathToString,
  resolveLocator,
} from "../path.ts";

const tree: Node = {
  $ref: "Card",
  children: [
    { $ref: "Heading", props: { level: 1 } },
    {
      $ref: "Card",
      children: [
        { $ref: "Text", props: { children: "x" } },
        { $ref: "Button", props: { children: "y" } },
      ],
    },
  ],
};

describe("path helpers", () => {
  test("pathToString / pathFromString roundtrip", () => {
    expect(pathToString([])).toBe("");
    expect(pathToString([0, 2, 1])).toBe("0.2.1");
    expect(pathFromString("")).toEqual([]);
    expect(pathFromString("0.2.1")).toEqual([0, 2, 1]);
  });

  test("pathFromString rejects bad segments", () => {
    expect(() => pathFromString("0.x.1")).toThrow();
    expect(() => pathFromString("-1")).toThrow();
  });

  test("pathAt navigates the tree", () => {
    const refOf = (path: number[]) => {
      const n = pathAt(tree, path);
      return n && "$ref" in n ? n.$ref : null;
    };
    expect(refOf([])).toBe("Card");
    expect(refOf([0])).toBe("Heading");
    expect(refOf([1])).toBe("Card");
    expect(refOf([1, 0])).toBe("Text");
    expect(refOf([1, 1])).toBe("Button");
  });

  test("pathAt returns null for out-of-range", () => {
    expect(pathAt(tree, [2])).toBeNull();
    expect(pathAt(tree, [0, 0])).toBeNull(); // Heading has no children
    expect(pathAt(tree, [1, 5])).toBeNull();
  });

  test("parentOf", () => {
    expect(parentOf([])).toBeNull();
    expect(parentOf([0])).toEqual({ parent: [], index: 0 });
    expect(parentOf([1, 2])).toEqual({ parent: [1], index: 2 });
  });

  test("coercePath accepts arrays and dot-strings", () => {
    expect(coercePath([0, 2, 1])).toEqual([0, 2, 1]);
    expect(coercePath("0.2.1")).toEqual([0, 2, 1]);
    expect(coercePath("")).toEqual([]);
    expect(coercePath([])).toEqual([]);
  });
});

describe("locator + findById", () => {
  const treeWithIds: Node = {
    $ref: "Card",
    $id: "root-card",
    children: [
      { $ref: "Heading", $id: "title", props: { level: 1 } },
      {
        $ref: "Card",
        $id: "body",
        children: [
          { $ref: "Text", $id: "intro", props: { children: "hi" } },
          {
            $snippet: "feature-card",
            $id: "hero",
            args: { title: "x" },
          },
        ],
      },
    ],
  };

  test("isIdLocator recognizes only @-prefixed strings of length > 1", () => {
    expect(isIdLocator("@x")).toBe(true);
    expect(isIdLocator("@hero-cta")).toBe(true);
    expect(isIdLocator("@")).toBe(false);
    expect(isIdLocator("hero-cta")).toBe(false);
    expect(isIdLocator(["@"] as unknown)).toBe(false);
    expect(isIdLocator([0])).toBe(false);
  });

  test("findById walks the tree and returns the first match's path", () => {
    expect(findById(treeWithIds, "root-card")).toEqual([]);
    expect(findById(treeWithIds, "title")).toEqual([0]);
    expect(findById(treeWithIds, "intro")).toEqual([1, 0]);
    expect(findById(treeWithIds, "hero")).toEqual([1, 1]);
    expect(findById(treeWithIds, "nope")).toBeNull();
  });

  test("findById doesn't descend into snippet instances (their body is opaque)", () => {
    // The snippet instance "hero" exists at [1, 1]. Its body (somewhere
    // else, in design/snippets/) may contain nodes with $id "inside" —
    // but those aren't reachable from this page's POV.
    const t: Node = {
      $ref: "Card",
      children: [{ $snippet: "feature-card", $id: "hero", args: {} }],
    };
    // Simulating a deep descent: even if a snippet body had an "intro" id,
    // findById on the *page* tree never sees it.
    expect(findById(t, "hero")).toEqual([0]);
    expect(findById(t, "anything-inside-the-snippet")).toBeNull();
  });

  test("resolveLocator handles path arrays and @id strings", () => {
    expect(resolveLocator(treeWithIds, [])).toEqual([]);
    expect(resolveLocator(treeWithIds, [1, 0])).toEqual([1, 0]);
    expect(resolveLocator(treeWithIds, "@title")).toEqual([0]);
    expect(resolveLocator(treeWithIds, "@hero")).toEqual([1, 1]);
  });

  test("resolveLocator returns null on out-of-range path", () => {
    expect(resolveLocator(treeWithIds, [99])).toBeNull();
    expect(resolveLocator(treeWithIds, [0, 0])).toBeNull(); // Heading has no children
  });

  test("resolveLocator returns null on unknown id", () => {
    expect(resolveLocator(treeWithIds, "@missing")).toBeNull();
  });

  test("resolveLocator tolerates a JSON-stringified path array", () => {
    // Agents constructing batch args as JSON commonly pass the array as a
    // string; "[]" for the root is the easy trip the dogfood flagged.
    expect(resolveLocator(treeWithIds, "[]")).toEqual([]);
    expect(resolveLocator(treeWithIds, " [] ")).toEqual([]);
    expect(resolveLocator(treeWithIds, "[1, 0]")).toEqual([1, 0]);
    // A bogus stringified path still misses, like its array form.
    expect(resolveLocator(treeWithIds, "[99]")).toBeNull();
    // An @id string that isn't a JSON array is untouched.
    expect(resolveLocator(treeWithIds, "@title")).toEqual([0]);
  });
});
