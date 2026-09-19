import { describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { placementTarget } from "../components/RepoDetail.tsx";

const screen: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    children: [
      { $ref: "Button", props: { children: "Go" } },
      { $ref: "Card", children: [{ $ref: "Text", props: { children: "Hi" } }] },
    ],
  },
};

const state = (path: string | null) => ({
  selection: path === null ? null : { screenId: "home", path },
  screens: { home: screen },
  currentScreenId: "home",
  repoCatalog: null,
});

describe("Add to screen placement", () => {
  test("a selected leaf gets the component right after it, not inside it", () => {
    expect(placementTarget(state("0"))).toEqual({
      screenId: "home",
      parentPath: [],
      index: 1,
      where: "after Button",
    });
  });

  test("a selected container gets it as its last child", () => {
    expect(placementTarget(state("1"))).toEqual({
      screenId: "home",
      parentPath: [1],
      where: "inside Card",
    });
  });

  test("with nothing selected it goes at the end of the open screen", () => {
    expect(placementTarget(state(null))).toEqual({
      screenId: "home",
      parentPath: [],
      where: "to Home",
    });
  });
});
