import { describe, expect, test } from "bun:test";
import { resolveSnippetArgs, type Snippet, substituteSnippetParams } from "../index.ts";

function snippetWith(params: Snippet["params"]): Snippet {
  return { id: "s", name: "S", params, tree: { $ref: "Box" } };
}

describe("substituteSnippetParams — param placement", () => {
  test("a node param fills a children slot", () => {
    const slot = { $ref: "Badge", props: { children: "new" } };
    const r = substituteSnippetParams({ $ref: "Box", children: [{ $param: "slot" }] }, { slot });
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.value).toEqual({ $ref: "Box", children: [slot] });
  });

  test("a scalar param fills a prop value", () => {
    const r = substituteSnippetParams(
      { $ref: "Heading", props: { children: { $param: "title" } } },
      { title: "Hello" },
    );
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.value).toEqual({ $ref: "Heading", props: { children: "Hello" } });
  });

  test("a scalar param placed directly in a children array is flagged", () => {
    const r = substituteSnippetParams(
      { $ref: "Box", children: [{ $param: "title" }] },
      { title: "Hello" },
    );
    expect(r.invalid).toEqual([{ param: "title", valueType: "string" }]);
    expect(r.missing).toEqual([]);
  });

  test("a `children` *prop* holding a scalar param is NOT flagged", () => {
    // props.children is content, not a node position — the correct wiring.
    const r = substituteSnippetParams(
      { $ref: "Heading", props: { children: { $param: "title" } } },
      { title: "Hi" },
    );
    expect(r.invalid).toEqual([]);
  });

  test("missing params are reported, not flagged as invalid", () => {
    const r = substituteSnippetParams({ $ref: "Box", children: [{ $param: "x" }] }, {});
    expect(r.missing).toEqual(["x"]);
    expect(r.invalid).toEqual([]);
  });

  test("$if branches keep node-position context", () => {
    const r = substituteSnippetParams(
      { $ref: "Box", children: [{ $if: "on", then: { $param: "label" }, else: { $ref: "Box" } }] },
      { on: true, label: "text" },
    );
    expect(r.invalid).toEqual([{ param: "label", valueType: "string" }]);
  });
});

describe("optional params (omitted → nothing)", () => {
  test("an omitted optional param is not reported missing", () => {
    const snippet = snippetWith([{ name: "badge", type: "node", optional: true }]);
    const { args, missing } = resolveSnippetArgs(snippet, {});
    expect(missing).toEqual([]);
    expect("badge" in args).toBe(true);
  });

  test("a non-optional param with no default is still missing", () => {
    const snippet = snippetWith([{ name: "badge", type: "node" }]);
    expect(resolveSnippetArgs(snippet, {}).missing).toEqual(["badge"]);
  });

  test("an omitted optional node slot is pruned from a children array (no gap, not invalid)", () => {
    const snippet = snippetWith([{ name: "badge", type: "node", optional: true }]);
    const { args } = resolveSnippetArgs(snippet, {});
    const r = substituteSnippetParams(
      {
        $ref: "Box",
        children: [{ $ref: "Heading", props: { children: "Title" } }, { $param: "badge" }],
      },
      args,
    );
    expect(r.invalid).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.value).toEqual({
      $ref: "Box",
      children: [{ $ref: "Heading", props: { children: "Title" } }],
    });
  });

  test("an omitted optional prop is left off the props object", () => {
    const snippet = snippetWith([{ name: "action", type: "node", optional: true }]);
    const { args } = resolveSnippetArgs(snippet, {});
    const r = substituteSnippetParams(
      { $ref: "Box", props: { id: "header", action: { $param: "action" } } },
      args,
    );
    expect(r.value).toEqual({ $ref: "Box", props: { id: "header" } });
  });

  test("a supplied optional param still fills its slot", () => {
    const snippet = snippetWith([{ name: "badge", type: "node", optional: true }]);
    const badge = { $ref: "Badge", props: { children: "New" } };
    const { args } = resolveSnippetArgs(snippet, { badge });
    const r = substituteSnippetParams({ $ref: "Box", children: [{ $param: "badge" }] }, args);
    expect(r.value).toEqual({ $ref: "Box", children: [badge] });
  });

  test("an omitted optional param reads falsy under $if", () => {
    const snippet = snippetWith([
      { name: "featured", type: "boolean", optional: true },
      { name: "badge", type: "node", optional: true },
    ]);
    const { args } = resolveSnippetArgs(snippet, {});
    const r = substituteSnippetParams(
      {
        $ref: "Box",
        children: [{ $if: "featured", then: { $param: "badge" }, else: { $ref: "Box" } }],
      },
      args,
    );
    expect(r.value).toEqual({ $ref: "Box", children: [{ $ref: "Box" }] });
  });
});
