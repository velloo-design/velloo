/** A session title is one line of plain text, short enough for a list row. */
const TITLE_CHARS = 60;

const FENCE = /^\s*(```|~~~)/;

const clip = (title: string) =>
  title.length > TITLE_CHARS ? `${title.slice(0, TITLE_CHARS - 1)}…` : title;

/**
 * One line of Markdown as the words it reads as. Emphasis is stripped only
 * where it can be emphasis — `*` and `_` hugging non-space text, `_` not
 * inside a word — so `snake_case` and `2 * 3` survive.
 */
function plainLine(line: string): string {
  // Code spans and escaped characters are set aside first, so nothing in
  // them is read as Markdown.
  const literal: string[] = [];
  const keep = (text: string) => `\uE000${literal.push(text) - 1}\uE000`;
  const text = line
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, (_, char: string) => keep(char))
    .replace(/(`+)(.+?)\1/g, (_, _ticks: string, inner: string) => keep(inner.trim()))
    .replace(/^\s{0,3}([-*_])(\s*\1){2,}\s*$/, "")
    .replace(/^\s{0,3}#{1,6}(\s+|$)/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/^\s*(>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])(?:\s+|$)(?:\[[ xX]\](?:\s+|$))?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2")
    .replace(/\uE000(\d+)\uE000/g, (_, n: string) => literal[Number(n)] ?? "");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * What a session no one named is called, from the prompt that opened it: the
 * first line that says something, as plain text — the list, the header and
 * the switcher all show it, and none of them renders Markdown.
 */
export function sessionTitle(text: string): string {
  let fenced = false;
  let firstCode = "";
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    // A prompt that is only a code block is named by its first line.
    if (fenced) {
      firstCode ||= line.replace(/\s+/g, " ").trim();
      continue;
    }
    const plain = plainLine(line);
    if (plain) return clip(plain);
  }
  return clip(firstCode);
}

/** The title the first prompt gave a session before titles were plain text. */
export function rawSessionTitle(text: string): string {
  return clip(text.trim().split("\n")[0] ?? "");
}
