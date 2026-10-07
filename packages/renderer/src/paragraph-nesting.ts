/**
 * Elements written inside a `<p>` that an HTML parser will not leave there.
 *
 * A paragraph holds phrasing content only, and the parser enforces it rather
 * than tolerating it: a `<div>`, a heading, a list or another `<p>` *ends* the
 * open paragraph, so what was written as a child is parsed as the paragraph's
 * next sibling. React never notices, because a client mount builds the DOM
 * node by node and nests whatever it is told to. The same tree therefore has
 * two layouts — nested where it is mounted, split where its server-rendered
 * markup is parsed (a screenshot, a comparison) — and in a flex or grid parent
 * the split pieces become items of their own.
 *
 * This reads the server-rendered markup the way the parser will and reports
 * each such element, so the design can be told before a capture disagrees
 * with the canvas.
 */

/** One element the parser moves out of the paragraph it was written in. */
export interface ParagraphBreak {
  /** The element's tag. */
  tag: string;
  /** `data-node-path` of the node it belongs to: its own, or the nearest above it. */
  path: string | null;
  /** The same, for the paragraph it was written inside. */
  paragraphPath: string | null;
}

/** Start tags that close an open `<p>` (HTML "in body" insertion mode). */
const ENDS_PARAGRAPH = new Set(
  (
    "address article aside blockquote center details dialog dir div dl dd dt fieldset " +
    "figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li listing main menu " +
    "nav ol p plaintext pre search section summary table ul xmp"
  ).split(" "),
);

/** Elements a `<p>` above them is not "in button scope" through. */
const SCOPE_BOUNDARY = new Set(
  "applet button caption html marquee object table td template th".split(" "),
);

const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);

/** Elements whose content is text, whatever it looks like. */
const RAW_TEXT = new Set("iframe noembed noframes noscript script style textarea title".split(" "));

/** Foreign content: none of the paragraph rules apply inside it. */
const FOREIGN = new Set(["svg", "math"]);

interface Open {
  tag: string;
  path: string | null;
  /** Already reported: what is inside it is no longer inside the paragraph. */
  moved: boolean;
}

const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const NODE_PATH = /\sdata-node-path=(?:"([^"]*)"|'([^']*)')/;

/** Index just past the `>` that ends the tag opening at `from`, quotes respected. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return html.length;
}

/** Index just past the end tag that closes the `tag` whose content starts at `from`. */
function skipContent(html: string, from: number, tag: string, nests: boolean): number {
  const token = new RegExp(`<(/?)${tag}(?=[\\s/>])`, "gi");
  token.lastIndex = from;
  let depth = 1;
  for (let match = token.exec(html); match; match = token.exec(html)) {
    const end = tagEnd(html, match.index);
    if (match[1]) depth -= 1;
    else if (nests && html[end - 2] !== "/") depth += 1;
    if (depth === 0) return end;
    token.lastIndex = end;
  }
  return html.length;
}

/** The paragraph `stack` holds open in button scope that nothing has been moved out of yet. */
function openParagraph(stack: Open[]): Open | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const open = stack[i] as Open;
    if (open.tag === "p") return open;
    if (open.moved || SCOPE_BOUNDARY.has(open.tag)) return null;
  }
  return null;
}

export function paragraphBreaks(html: string): ParagraphBreak[] {
  const breaks: ParagraphBreak[] = [];
  const stack: Open[] = [];
  let at = html.indexOf("<");
  while (at !== -1) {
    if (html.startsWith("<!--", at)) {
      const close = html.indexOf("-->", at + 4);
      at = close === -1 ? -1 : html.indexOf("<", close + 3);
      continue;
    }
    const closing = html[at + 1] === "/";
    TAG_NAME.lastIndex = at + (closing ? 2 : 1);
    const name = TAG_NAME.exec(html)?.[0].toLowerCase();
    if (!name) {
      at = html.indexOf("<", at + 1);
      continue;
    }
    let next = tagEnd(html, at);
    if (closing) {
      const open = stack.findLastIndex((entry) => entry.tag === name);
      if (open !== -1) stack.length = open;
    } else {
      const source = html.slice(at, next);
      const own = NODE_PATH.exec(source);
      const path = own ? (own[1] ?? own[2] ?? "") : (stack.at(-1)?.path ?? null);
      const paragraph = ENDS_PARAGRAPH.has(name) ? openParagraph(stack) : null;
      if (paragraph) breaks.push({ tag: name, path, paragraphPath: paragraph.path });
      if (RAW_TEXT.has(name)) next = skipContent(html, next, name, false);
      else if (FOREIGN.has(name)) {
        if (!source.endsWith("/>")) next = skipContent(html, next, name, true);
      } else if (!VOID.has(name)) stack.push({ tag: name, path, moved: paragraph !== null });
    }
    at = html.indexOf("<", next);
  }
  return breaks;
}
