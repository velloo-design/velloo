import { describe, expect, test } from "bun:test";
import { substituteSnippetParams } from "../index.ts";

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
