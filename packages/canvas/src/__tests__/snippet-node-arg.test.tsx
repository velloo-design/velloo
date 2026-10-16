import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { SnippetInstance, SnippetParam } from "@velloo/schema";
import { $, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder, snippetFixture } from "./fake-server.ts";

/**
 * A snippet instance's `node` arg, as the inspector edits it. The field used
 * to commit whatever was typed as a string, and a string in a node position is
 * text — so touching the field of an instance holding an app component, by a
 * single character, replaced the component with its own JSON written out.
 *
 * `card` is a slot the body fills as a child, so only a node goes there;
 * `review` is a `node` param carrying data into a prop, which takes any JSON.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { SnippetInspector } = await import("../components/SnippetInspector.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

/** The inspector's arg write is debounced; this is past it. */
const WRITTEN = 320;

const PARAMS = [
  { name: "card", type: "node" },
  { name: "review", type: "node" },
] as SnippetParam[];
const BODY = {
  $ref: "Box",
  children: [{ $param: "card" }, { $ref: "ReviewCard", props: { review: { $param: "review" } } }],
};
const CARD = { $ref: "ReviewCard", props: { rating: 5 } };

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

async function inspect(args: Record<string, unknown>) {
  const instance = { $snippet: "review", args } as SnippetInstance;
  const view = await mount(
    <SnippetInspector selection={{ screenId: "home", path: "0" }} node={instance} />,
  );
  views.push(view);
  // The body comes in after the first paint; it says which params are slots.
  await settle(20);
  return field();
}

const field = (param = "card") => $(`#snip-arg-${param}`) as HTMLInputElement;

async function type(value: string, param = "card"): Promise<void> {
  await interact(() => typeInto(field(param), value));
  await settle(WRITTEN);
}

/** What each `update_snippet_args` wrote for `param`. */
const written = (param = "card") =>
  server.mutations
    .filter((m) => m.op === "update_snippet_args")
    .map((m) => (m.args as { argPatch: Record<string, unknown> }).argPatch[param]);

beforeEach(() => {
  server = serveFolder();
  server.snippets.review = { ...snippetFixture("review"), params: PARAMS, tree: BODY } as never;
  server.design.snippets = [{ id: "review", name: "review", params: PARAMS }];
  setApiConnected(true);
  useCanvas.setState({ design: server.design as never });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("a snippet's node arg in the inspector", () => {
  test("shows the node it holds as JSON", async () => {
    await inspect({ card: CARD });
    expect(JSON.parse(field().value)).toEqual(CARD);
  });

  test("an edit to the node writes the node, not its source as text", async () => {
    await inspect({ card: CARD });
    await type(JSON.stringify({ ...CARD, props: { rating: 4 } }));
    expect(written()).toEqual([{ $ref: "ReviewCard", props: { rating: 4 } }]);
  });

  test("JSON that is not a node is held back and says so", async () => {
    await inspect({ card: CARD });
    await type("{}");
    await type('{"$ref":"ReviewCa');
    await type('[{"rating":5}]');
    expect(written()).toEqual([]);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(text(document.body)).toContain("Not saved");
  });

  test("plain text is written as text", async () => {
    await inspect({ card: "Five stars" });
    expect(field().value).toBe("Five stars");
    await type("Four stars");
    expect(written()).toEqual(["Four stars"]);
  });

  test("text the server saved as a text node shows as text", async () => {
    await inspect({ card: { $text: "Five stars" } });
    expect(field().value).toBe("Five stars");
  });

  test("a list of nodes and strings is written as a list", async () => {
    await inspect({});
    await type('["Rated ", {"$ref":"ReviewCard"}]');
    expect(written()).toEqual([["Rated ", { $ref: "ReviewCard" }]]);
  });

  test("null or an empty field clears the arg", async () => {
    await inspect({ card: CARD });
    await type("null");
    await type("");
    expect(written()).toEqual([null, null]);
  });

  test("text that starts like JSON is written by quoting it", async () => {
    await inspect({ card: "[beta] reviews" });
    expect(field().value).toBe('"[beta] reviews"');
    await type('"{draft} reviews"');
    expect(written()).toEqual(["{draft} reviews"]);
  });

  test("a param that carries data into a prop takes any JSON", async () => {
    await inspect({ review: { rating: 5 } });
    await type('{"rating":4,"text":"Good"}', "review");
    await type('{"rating":4,"te', "review");
    expect(written("review")).toEqual([{ rating: 4, text: "Good" }]);
    expect(text(document.body)).toContain("Not saved — not JSON yet.");
  });
});
