/**
 * The markdown notes and comments are written in, as data.
 *
 * Deliberately small: headings (`#`, `##`, `###`), bold, italic and links.
 * Everything else is text. One source line is one line here, blank lines
 * included, so a note reads exactly as it was typed — the read-only renderer
 * and the live editor draw from this same parse, which is what keeps the two
 * looking identical.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

type LineKind = "p" | "h1" | "h2" | "h3";

export interface Line {
  kind: LineKind;
  inline: Inline[];
}

const HEADING = /^(#{1,3}) (.*)$/;

export function parseMarkdown(source: string): Line[] {
  return source.split("\n").map((raw) => {
    const heading = HEADING.exec(raw);
    if (heading) {
      const level = (heading[1] as string).length as 1 | 2 | 3;
      return { kind: `h${level}`, inline: parseInline(heading[2] as string) };
    }
    return { kind: "p", inline: parseInline(raw) };
  });
}

/**
 * Only links a reader can follow safely: the web and mail. Anything else —
 * `javascript:`, `data:` — stays the text it was written as.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const link = LINK.exec(rest);
    if (link) {
      const href = safeHref(link[2] as string);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: parseInline(link[1] as string) });
        i += link[0].length;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    const marker = text[i];
    if (marker === "*" || marker === "_") {
      const end = text.indexOf(marker, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += marker;
    i++;
  }
  flush();
  return out;
}
