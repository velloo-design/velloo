import { describe, expect, test } from "bun:test";
import type { Node } from "@velloo/schema";
import { coercePath, parentOf, pathAt, pathFromString, pathToString } from "../path.ts";

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
    expect(pathAt(tree, [])?.$ref).toBe("Card");
    expect(pathAt(tree, [0])?.$ref).toBe("Heading");
    expect(pathAt(tree, [1])?.$ref).toBe("Card");
    expect(pathAt(tree, [1, 0])?.$ref).toBe("Text");
    expect(pathAt(tree, [1, 1])?.$ref).toBe("Button");
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
