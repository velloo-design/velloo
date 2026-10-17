import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { designScreen, type TestContext, testContext } from "../../testing/design-folder.ts";
import { addSnippet, setScreenTree } from "../index.ts";

/**
 * A tree written as JSON reads a lowercase tag the way compose's JSX does: as
 * an element, drawn by the adapter's element component through `as`. GPT-6 Sol
 * wrote snippet bodies of `article`, `div` and `span`, and `add_snippet` refused
 * the first as an unknown component.
 */

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    label: "element-refs",
    screens: { home: designScreen("home", { tree: { $ref: "Box", children: [] } }) },
  });
});
afterEach(() => t.cleanup());

describe("a lowercase $ref", () => {
  test("in a snippet body is the element component, with the tag as `as`", async () => {
    const r = await addSnippet(t.ctx, {
      id: "review-note",
      name: "Review note",
      params: [{ name: "quote", type: "string" }],
      tree: {
        $ref: "article",
        props: { className: "rounded-lg border p-6" },
        children: [{ $ref: "p", props: { children: { $param: "quote" } } }],
      },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(t.ctx.folder.snippets.get("review-note")?.tree).toEqual({
      $ref: "Box",
      props: { as: "article", className: "rounded-lg border p-6" },
      children: [{ $ref: "Box", props: { as: "p", children: { $param: "quote" } } }],
    });
  });

  test("keeps an `as` it was given, and a capitalised unknown name is still refused", async () => {
    const r = await setScreenTree(t.ctx, {
      screenId: "home",
      tree: { $ref: "section", props: { as: "main" }, children: [] },
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(t.ctx.folder.screens.get("home")?.tree).toMatchObject({
      $ref: "Box",
      props: { as: "main" },
    });

    const unknown = await setScreenTree(t.ctx, {
      screenId: "home",
      tree: { $ref: "Sectoin", children: [] },
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.kind).toBe("UnknownComponent");
  });
});
