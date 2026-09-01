import { expect, test } from "bun:test";
import type { Board, Screen, Snippet } from "@velloo/schema";
import { selectChangedPreviews } from "../publish/changed-previews.ts";

const screen = (id: string, tree: unknown = { $ref: "Box" }): Screen =>
  ({ id, name: id, tree }) as Screen;

const board = (id: string, screenIds: string[]): Board => ({
  id,
  name: id,
  frames: screenIds.map((screenId, index) => ({
    id: `f${index}`,
    screen: screenId,
    x: 0,
    y: 0,
    w: 400,
    h: 300,
  })),
  groups: [],
});

test("reuses CI dependency expansion and selects boards containing changed screens", () => {
  const screens = [screen("home", { $snippet: "hero" }), screen("pricing"), screen("settings")];
  const snippets = new Map<string, Snippet>([
    ["hero", { id: "hero", name: "Hero", tree: { $ref: "Box" } } as Snippet],
  ]);
  const selection = selectChangedPreviews(
    [{ status: "M", path: "snippets/hero.json" }],
    screens,
    snippets,
    [board("marketing", ["home", "pricing"]), board("app", ["settings"])],
  );
  expect([...selection.screenIds]).toEqual(["home"]);
  expect([...selection.boardIds]).toEqual(["marketing"]);
});

test("direct board layout changes recapture only that composite", () => {
  const selection = selectChangedPreviews(
    [{ status: "M", path: "boards/app.json" }],
    [screen("home")],
    new Map(),
    [board("marketing", ["home"]), board("app", ["home"])],
  );
  expect([...selection.screenIds]).toEqual([]);
  expect([...selection.boardIds]).toEqual(["app"]);
});

test("theme changes recapture every current screen and selected board", () => {
  const selection = selectChangedPreviews(
    [{ status: "M", path: "theme/default.json" }],
    [screen("home"), screen("pricing")],
    new Map(),
    [board("main", ["home", "pricing"])],
  );
  expect([...selection.screenIds]).toEqual(["home", "pricing"]);
  expect([...selection.boardIds]).toEqual(["main"]);
});
