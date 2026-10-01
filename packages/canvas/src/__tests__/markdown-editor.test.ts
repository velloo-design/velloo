import { describe, expect, test } from "bun:test";
import { parseMarkdown, safeHref } from "../markdown/parse.ts";
import { domSuite } from "./dom.ts";

/**
 * The markdown notes and comments are written in, and the live editor's DOM
 * for it: what parses, what round-trips, and what typing turns into.
 */

describe("parseMarkdown", () => {
  test("one line per source line, headings by their marker, blank lines kept", () => {
    expect(parseMarkdown("# One\n\n## Two\n### Three\nplain").map((l) => l.kind)).toEqual([
      "h1",
      "p",
      "h2",
      "h3",
      "p",
    ]);
  });

  test("bold, italic and links, with emphasis inside a link", () => {
    expect(parseMarkdown("a **b** *c* [**d**](https://x.dev) _e_")[0]?.inline).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      {
        kind: "link",
        href: "https://x.dev",
        children: [{ kind: "strong", children: [{ kind: "text", text: "d" }] }],
      },
      { kind: "text", text: " " },
      { kind: "em", children: [{ kind: "text", text: "e" }] },
    ]);
  });

  test("`- ` and `* ` lines are bullets, and `*italic*` at a line start is not", () => {
    expect(parseMarkdown("- one\n* two\n*three*").map((l) => l.kind)).toEqual(["li", "li", "p"]);
  });

  test("a link a reader couldn't follow safely stays text", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(parseMarkdown("[x](javascript:alert(1))")[0]?.inline[0]?.kind).toBe("text");
  });
});

const { applyInputRules, editorToMarkdown, fillEditor, unwrapListItem } = await import(
  "../markdown/editor-dom.ts"
);

function editor(html = ""): HTMLElement {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

/** Put the caret at the end of the last text node, as typing leaves it. */
function caretAtEnd(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, 4);
  let last: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n;
  const range = document.createRange();
  range.setStart(last as Node, (last?.textContent ?? "").length);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

domSuite("the editor's document", () => {
  test("markdown read in and written back out is unchanged", () => {
    const source = "# Title\n\nSome **bold**, *italic* and [a link](https://velloo.dev).\n## Next";
    const root = editor();
    fillEditor(root, source);
    expect(editorToMarkdown(root)).toBe(source);
  });

  test("what the browser's own editing produces still writes clean markdown", () => {
    const root = editor(
      "<div>one<br>two</div><div><b>bold</b> and <i>it </i>end</div><div><br></div>",
    );
    expect(editorToMarkdown(root)).toBe("one\ntwo\n**bold** and *it* end\n");
  });

  test("`## ` at the start of a line makes it a heading", () => {
    const root = editor("<div>## </div>");
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(true);
    expect(root.firstElementChild?.tagName).toBe("H2");
    expect(editorToMarkdown(root)).toBe("## ");
  });

  test("closing `**` turns the run bold, and typing carries on outside it", () => {
    const root = editor("<div>make **this**</div>");
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(true);
    expect(root.querySelector("strong")?.textContent).toBe("this");
    expect(editorToMarkdown(root)).toBe("make **this**");
  });

  test("a closed `[text](url)` becomes a link; an unsafe one is left as typed", () => {
    const root = editor("<div>see [docs](https://velloo.dev)</div>");
    caretAtEnd(root);
    applyInputRules(root);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://velloo.dev");

    const unsafe = editor("<div>[x](javascript:alert)</div>");
    caretAtEnd(unsafe);
    expect(applyInputRules(unsafe)).toBe(false);
  });

  test("single `*` and `_` runs turn italic", () => {
    for (const typed of ["an *idea*", "an _idea_"]) {
      const root = editor(`<div>${typed}</div>`);
      caretAtEnd(root);
      applyInputRules(root);
      expect(root.querySelector("em")?.textContent).toBe("idea");
    }
  });

  test("an insert that closes several runs at once converts them all", () => {
    const root = editor(
      "<div>Some **bold** and *soft* words, see [docs](https://velloo.dev) ok</div>",
    );
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(true);
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("em")?.textContent).toBe("soft");
    expect(root.querySelector("a")?.textContent).toBe("docs");
    expect(editorToMarkdown(root)).toBe(
      "Some **bold** and *soft* words, see [docs](https://velloo.dev) ok",
    );
  });

  test("a run still open at the caret is left for the user to close", () => {
    const root = editor("<div>**not yet</div>");
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(false);
  });

  test("`# ` alone makes an empty heading the caret stays in, so typing lands in it", () => {
    const root = editor("<div>#\u00A0</div>");
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(true);
    const heading = root.firstElementChild as HTMLElement;
    expect(heading.tagName).toBe("H1");
    expect(heading.innerHTML).toBe("<br>");
    expect(document.getSelection()?.anchorNode).toBe(heading);
  });

  test("`- ` makes a bullet, and joins the list just above", () => {
    const root = editor("<ul><li>one</li></ul><div>- </div>");
    caretAtEnd(root);
    expect(applyInputRules(root)).toBe(true);
    expect(root.innerHTML).toBe("<ul><li>one</li><li><br></li></ul>");
    expect(editorToMarkdown(root)).toBe("- one\n- ");
  });

  test("bullets round-trip, and taking one out splits its list", () => {
    const source = "Intro\n- one\n- two\n- three\nOutro";
    const root = editor();
    fillEditor(root, source);
    expect(editorToMarkdown(root)).toBe(source);
    unwrapListItem(root.querySelectorAll("li")[1] as HTMLLIElement);
    expect(editorToMarkdown(root)).toBe("Intro\n- one\ntwo\n- three\nOutro");
    expect(root.querySelectorAll("ul")).toHaveLength(2);
  });
});
