import { groupBullets, type Inline, type Line, parseMarkdown, safeHref } from "./parse.ts";

/**
 * The live editor's document, as plain DOM inside a `contentEditable` root:
 * one block per line (`div`, `h1`–`h3`, or an `li` in a `ul`) holding text,
 * `strong`, `em` and `a`.
 * Markdown is still the storage format — `fillEditor` reads it in through the
 * same parse the read-only renderer uses, and `editorToMarkdown` writes the
 * DOM back out, whatever the browser's own editing made of it.
 */

/** A placeholder the caret can sit in after a just-closed inline; never stored. */
const CARET_ANCHOR = "​";

const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
]);

export function fillEditor(root: HTMLElement, source: string): void {
  const doc = root.ownerDocument;
  const block = (tag: string, line: Line) => {
    const el = doc.createElement(tag);
    if (line.inline.length === 0) el.append(doc.createElement("br"));
    else el.append(...inlineNodes(doc, line.inline));
    return el;
  };
  root.replaceChildren(
    ...groupBullets(parseMarkdown(source)).map((group) => {
      if (!Array.isArray(group)) return block(group.kind === "p" ? "div" : group.kind, group);
      const list = doc.createElement("ul");
      list.append(...group.map((line) => block("li", line)));
      return list;
    }),
  );
}

function inlineNodes(doc: Document, nodes: Inline[]): Node[] {
  return nodes.map((node) => {
    if (node.kind === "text") return doc.createTextNode(node.text);
    const el = doc.createElement(node.kind === "link" ? "a" : node.kind);
    if (node.kind === "link") el.setAttribute("href", node.href);
    el.append(...inlineNodes(doc, node.children));
    return el;
  });
}

const isBlock = (node: Node): node is HTMLElement =>
  node.nodeType === 1 && BLOCK_TAGS.has((node as HTMLElement).tagName);

function linePrefix(el: Element): string {
  const tag = el.tagName;
  if (tag === "LI") return "- ";
  if (tag === "H1") return "# ";
  if (tag === "H2") return "## ";
  if (/^H[3-6]$/.test(tag)) return "### ";
  return "";
}

export function editorToMarkdown(root: HTMLElement): string {
  const lines: string[] = [];
  blockLines(root, "", lines, true);
  return lines.join("\n");
}

/** Each block is at least one line; a `<br>` inside it starts another. */
function blockLines(el: Element, prefix: string, out: string[], isRoot = false): void {
  const before = out.length;
  let buffer = "";
  let open = false;
  let first = true;
  const flush = (force: boolean) => {
    if (open || force) {
      out.push((first ? prefix : "") + buffer);
      first = false;
    }
    buffer = "";
    open = false;
  };
  const kids = [...el.childNodes];
  kids.forEach((node, index) => {
    if (isBlock(node)) {
      flush(false);
      blockLines(node, linePrefix(node), out);
      return;
    }
    if (node.nodeName === "BR") {
      // The browser's placeholder that keeps an empty or line-ending block
      // tall — it isn't a line of its own.
      if (index === kids.length - 1) return;
      flush(true);
      return;
    }
    buffer += inlineMarkdown(node, new Set());
    open = true;
  });
  flush(false);
  if (!isRoot && out.length === before) out.push(prefix);
}

function inlineMarkdown(node: Node, marks: Set<string>): string {
  if (node.nodeType === 3) {
    return (node.textContent ?? "").replaceAll(CARET_ANCHOR, "").replaceAll(" ", " ");
  }
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  if (el.tagName === "BR") return " ";
  const mark =
    el.tagName === "STRONG" || el.tagName === "B"
      ? "**"
      : el.tagName === "EM" || el.tagName === "I"
        ? "*"
        : null;
  const inner = (next: Set<string>) =>
    [...el.childNodes].map((child) => inlineMarkdown(child, next)).join("");
  if (el.tagName === "A") {
    const text = inner(marks);
    const href = safeHref(el.getAttribute("href") ?? "");
    return href && text.trim() ? `[${text}](${href})` : text;
  }
  if (!mark || marks.has(mark)) return inner(marks);
  const text = inner(new Set([...marks, mark]));
  // Markers hug the text: `** bold**` isn't bold, so edge spaces go outside.
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [, lead = "", core = "", trail = ""] = match ?? [];
  return core ? `${lead}${mark}${core}${mark}${trail}` : text;
}

/** The root's direct child holding `node` — the line it's on. */
export function lineOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  return current && current.nodeType === 1 ? (current as HTMLElement) : null;
}

/** Swap a line's tag (`div` ↔ `h2` …) keeping its contents and, where it can, the caret. */
export function retagLine(line: HTMLElement, tag: "div" | "h1" | "h2" | "h3"): HTMLElement {
  if (line.tagName.toLowerCase() === tag) return line;
  const next = line.ownerDocument.createElement(tag);
  next.append(...line.childNodes);
  if (!next.firstChild) next.append(line.ownerDocument.createElement("br"));
  line.replaceWith(next);
  return next;
}

/**
 * Turn what was just typed into what it means: `# `–`### ` at the start of a
 * line makes a heading; a closing `**`, `*`, `_` or `)` turns the run it ends
 * into bold, italic or a link. Returns whether anything changed.
 */
export function applyInputRules(root: HTMLElement): boolean {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const node = selection.anchorNode;
  if (node?.nodeType !== 3 || !root.contains(node)) return false;
  const text = node as Text;

  // Text typed straight into the root (an emptied editor) gets a line first.
  if (text.parentNode === root) {
    const offset = selection.anchorOffset;
    const line = root.ownerDocument.createElement("div");
    text.replaceWith(line);
    line.append(text);
    placeCaret(selection, text, offset);
  }

  return (
    headingRule(root, selection, text) ||
    bulletRule(root, selection, text) ||
    inlineRule(selection, text)
  );
}

const HEADING_TRIGGER = /^(#{1,3})[  ]/;

function headingRule(root: HTMLElement, selection: Selection, text: Text): boolean {
  const line = lineOf(root, text);
  if (!line || (line.tagName !== "DIV" && line.tagName !== "P")) return false;
  // Only the line's first run can carry the marker.
  const first = firstText(line);
  if (first !== text) return false;
  const match = HEADING_TRIGGER.exec(text.data);
  if (!match) return false;
  const offset = selection.anchorOffset - match[0].length;
  text.data = text.data.slice(match[0].length);
  const level = (match[1] as string).length as 1 | 2 | 3;
  caretInto(selection, retagLine(line, `h${level}`), text, offset);
  return true;
}

const BULLET_TRIGGER = /^[-*][ \u00A0]/;

/** `- ` or `* ` at the start of a plain line makes it a bullet, joining a list beside it. */
function bulletRule(root: HTMLElement, selection: Selection, text: Text): boolean {
  const line = lineOf(root, text);
  if (!line || (line.tagName !== "DIV" && line.tagName !== "P")) return false;
  if (firstText(line) !== text) return false;
  const match = BULLET_TRIGGER.exec(text.data);
  if (!match) return false;
  const offset = selection.anchorOffset - match[0].length;
  text.data = text.data.slice(match[0].length);
  const item = line.ownerDocument.createElement("li");
  item.append(...line.childNodes);
  const before = line.previousElementSibling;
  const after = line.nextElementSibling;
  if (before?.tagName === "UL") {
    before.append(item);
    line.remove();
  } else if (after?.tagName === "UL") {
    after.prepend(item);
    line.remove();
  } else {
    const list = line.ownerDocument.createElement("ul");
    list.append(item);
    line.replaceWith(list);
  }
  caretInto(selection, item, text, offset);
  return true;
}

/**
 * Put the caret back in `text` after its marker was stripped — or, when that
 * left it empty, at the start of its line: an empty text node gives a line no
 * height, and the browser won't keep a caret in it (what's typed next would
 * land outside the heading or bullet just made).
 */
function caretInto(selection: Selection, line: HTMLElement, text: Text, offset: number): void {
  if (text.data.length > 0) {
    placeCaret(selection, text, Math.max(0, offset));
    return;
  }
  text.remove();
  if (!line.firstChild) line.append(line.ownerDocument.createElement("br"));
  placeCaret(selection, line, 0);
}

/** The list item holding `node`, inside `root`. */
export function listItemOf(root: HTMLElement, node: Node | null): HTMLLIElement | null {
  let current = node;
  while (current && current !== root) {
    if (current.nodeName === "LI") return current as HTMLLIElement;
    current = current.parentNode;
  }
  return null;
}

/**
 * Take a bullet back out of its list as a plain line, splitting the list
 * around it, and return the new line.
 */
export function unwrapListItem(item: HTMLLIElement): HTMLElement {
  const doc = item.ownerDocument;
  const list = item.parentElement as HTMLElement;
  const line = doc.createElement("div");
  line.append(...item.childNodes);
  if (!line.firstChild) line.append(doc.createElement("br"));
  const rest = [...list.children].slice([...list.children].indexOf(item) + 1);
  item.remove();
  if (rest.length > 0) {
    const tail = doc.createElement("ul");
    tail.append(...rest);
    list.after(line, tail);
  } else {
    list.after(line);
  }
  if (list.children.length === 0) list.remove();
  return line;
}

/** Make a plain line a bullet (the toolbar's way in; typing uses `- `). */
export function bulletLine(line: HTMLElement): HTMLLIElement {
  const doc = line.ownerDocument;
  const item = doc.createElement("li");
  item.append(...line.childNodes);
  if (!item.firstChild) item.append(doc.createElement("br"));
  const before = line.previousElementSibling;
  if (before?.tagName === "UL") {
    before.append(item);
    line.remove();
  } else {
    const list = doc.createElement("ul");
    list.append(item);
    line.replaceWith(list);
  }
  return item;
}

function firstText(el: Node): Text | null {
  const walker = el.ownerDocument?.createTreeWalker(el, 4);
  return (walker?.nextNode() as Text | null) ?? null;
}

const INLINE_RULES: {
  pattern: RegExp;
  build(doc: Document, match: RegExpExecArray): HTMLElement | null;
  /** Characters of the match before the opening marker (a guard char). */
  lead?: (match: RegExpExecArray) => number;
}[] = [
  {
    pattern: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    build(doc, match) {
      const href = safeHref(match[2] as string);
      if (!href) return null;
      const a = doc.createElement("a");
      a.setAttribute("href", href);
      a.textContent = match[1] as string;
      return a;
    },
  },
  {
    pattern: /\*\*([^*\n]+)\*\*/,
    build(doc, match) {
      const el = doc.createElement("strong");
      el.textContent = match[1] as string;
      return el;
    },
  },
  {
    pattern: /(^|[^*])\*([^*\s][^*\n]*)\*(?!\*)/,
    lead: (match) => (match[1] as string).length,
    build(doc, match) {
      const el = doc.createElement("em");
      el.textContent = match[2] as string;
      return el;
    },
  },
  {
    pattern: /(^|[^\w_])_([^_\s][^_\n]*)_(?![\w_])/,
    lead: (match) => (match[1] as string).length,
    build(doc, match) {
      const el = doc.createElement("em");
      el.textContent = match[2] as string;
      return el;
    },
  },
];

/**
 * Convert every run closed before the caret — typing closes one at a time,
 * but a paste or a fast insert can close several at once. A run the caret is
 * still inside (`**bo|`) is left alone until it's closed.
 */
function inlineRule(selection: Selection, text: Text): boolean {
  let changed = false;
  let current = text;
  let caret = selection.anchorOffset;
  for (;;) {
    const found = earliestRun(current.ownerDocument, current.data, caret);
    if (!found) return changed;
    const { start, end, el } = found;
    const after = current.data.slice(end);
    current.data = current.data.slice(0, start);
    // Something for the caret to sit in past the new element, so what comes
    // next is typed as plain text rather than extending the bold.
    const rest = current.ownerDocument.createTextNode(after || CARET_ANCHOR);
    current.after(el, rest);
    caret = after ? caret - end : CARET_ANCHOR.length;
    placeCaret(selection, rest, caret);
    current = rest;
    changed = true;
  }
}

function earliestRun(
  doc: Document,
  data: string,
  caret: number,
): { start: number; end: number; el: HTMLElement } | null {
  let best: { start: number; end: number; el: HTMLElement } | null = null;
  for (const rule of INLINE_RULES) {
    const pattern = new RegExp(rule.pattern.source, "g");
    for (let match = pattern.exec(data); match; match = pattern.exec(data)) {
      const end = match.index + match[0].length;
      if (end > caret) break;
      const start = match.index + (rule.lead?.(match) ?? 0);
      if (best && start >= best.start) break;
      const el = rule.build(doc, match);
      if (el) {
        best = { start, end, el };
        break;
      }
    }
  }
  return best;
}

function placeCaret(selection: Selection, node: Node, offset: number): void {
  const range = (node.ownerDocument ?? (node as Document)).createRange();
  if (!range) return;
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
