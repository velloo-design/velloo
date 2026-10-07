import { describe, expect, test } from "bun:test";
import { paragraphBreaks } from "../paragraph-nesting.ts";

/**
 * The markup here is what `renderToString` writes: well-formed, with a
 * `data-node-path` on each design node. The parser is what would rearrange it.
 */
describe("paragraphBreaks", () => {
  test("a block element in a paragraph is reported with both paths", () => {
    const html =
      '<div data-node-path=""><p data-node-path="0">Trail <h2 data-node-path="0.1">Skyline</h2></p></div>';
    expect(paragraphBreaks(html)).toEqual([{ tag: "h2", path: "0.1", paragraphPath: "0" }]);
  });

  test("every element written into the paragraph is reported, not only the first", () => {
    const html =
      '<p data-node-path="">a <p data-node-path="1">b</p> c <div data-node-path="3"></div></p>';
    expect(paragraphBreaks(html).map((found) => found.path)).toEqual(["1", "3"]);
  });

  test("phrasing content is left alone", () => {
    const html =
      '<p data-node-path="">a <span data-node-path="1">b</span><a href="#">c</a><br/><img src="x"/><b>d</b></p>';
    expect(paragraphBreaks(html)).toEqual([]);
  });

  test("what is inside a moved element is no longer inside the paragraph", () => {
    const html =
      '<p data-node-path=""><div data-node-path="0"><p data-node-path="0.0">fine</p></div></p>';
    expect(paragraphBreaks(html)).toEqual([{ tag: "div", path: "0", paragraphPath: "" }]);
  });

  test("a moved paragraph is still a paragraph", () => {
    const html =
      '<p data-node-path=""><p data-node-path="0"><ul data-node-path="0.0"></ul></p></p>';
    expect(paragraphBreaks(html)).toEqual([
      { tag: "p", path: "0", paragraphPath: "" },
      { tag: "ul", path: "0.0", paragraphPath: "0" },
    ]);
  });

  test("a button between them keeps the paragraph open", () => {
    const html = '<p data-node-path=""><button data-node-path="0"><div>label</div></button></p>';
    expect(paragraphBreaks(html)).toEqual([]);
  });

  test("an element with no path of its own is reported at the node that rendered it", () => {
    const html = '<p data-node-path="2"><span data-node-path="2.0"><hr/></span></p>';
    expect(paragraphBreaks(html)).toEqual([{ tag: "hr", path: "2.0", paragraphPath: "2" }]);
  });

  test("a paragraph that has ended holds nothing", () => {
    const html =
      '<p data-node-path="0">a</p><div data-node-path="1"><p data-node-path="1.0">b</p></div>';
    expect(paragraphBreaks(html)).toEqual([]);
  });

  test("markup that only looks like elements is not read as any", () => {
    const html =
      '<p data-node-path="" title="a > b <div>"><!-- <div> --><style>p > div { color: red }</style>' +
      '<svg viewBox="0 0 1 1"><title>t</title><foreignObject><div></div></foreignObject><svg><p></p></svg></svg>' +
      "<textarea><div></textarea>x</p>";
    expect(paragraphBreaks(html)).toEqual([]);
  });
});
