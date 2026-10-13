import { describe, expect, test } from "bun:test";
import { showsLoadingState } from "../screenshot-helpers.ts";

/**
 * `compare_to_url` waits out a page that says it is loading and calls the
 * capture unverified if it never stops. The loading state of a step is a
 * screen of its own on a flow board, and its implementation never stops
 * saying so: compared with its design, it was always "unverified".
 */
describe("showsLoadingState", () => {
  test("a busy region anywhere in the tree", () => {
    expect(
      showsLoadingState({
        $ref: "Card",
        children: [{ $ref: "Button", props: { "aria-busy": "true", children: "Creating…" } }],
      }),
    ).toBe(true);
    expect(showsLoadingState({ $ref: "Box", props: { "aria-busy": true } })).toBe(true);
  });

  test("a label that says so, as a child, a text node or in a slot", () => {
    expect(showsLoadingState({ $ref: "Text", props: { children: "Loading…" } })).toBe(true);
    expect(showsLoadingState({ $ref: "Box", children: [{ $text: " loading... " }] })).toBe(true);
    expect(
      showsLoadingState({
        $ref: "Empty",
        props: { title: { $ref: "Text", props: { children: ["Loading"] } } },
      }),
    ).toBe(true);
  });

  test("a screen that is not one", () => {
    expect(
      showsLoadingState({
        $ref: "Box",
        props: { className: "loading", "aria-busy": "false", alt: "Loading" },
        children: [
          { $ref: "Text", props: { children: "Loading dock schedule" } },
          { $ref: "Image", props: { loading: "lazy" } },
        ],
      }),
    ).toBe(false);
  });
});
