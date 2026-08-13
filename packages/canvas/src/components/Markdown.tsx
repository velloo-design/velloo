import { Fragment, type JSX } from "react";

/**
 * Tiny markdown renderer for annotations + notes. Supported subset:
 *
 *  - `# h1`, `## h2`, `### h3` (line-start)
 *  - `**bold**`, `*italic*` (non-nesting)
 *  - Blank line → paragraph break
 *  - Single line break → `<br>`
 *  - Emojis pass through as literal unicode
 *
 * Not supported (intentional, to keep the renderer small): links, lists,
 * code blocks, images, blockquotes. Anything we don't recognize renders as
 * plain text. Markdown is the storage format; this is purely a viewer.
 */
export function Markdown({ body }: { body: string }): JSX.Element {
  const blocks = splitBlocks(body);
  return (
    <>
      {blocks.map((block, i) => (
        // Markdown blocks are derived from the body string and have no stable
        // id; the parent re-renders whenever body changes anyway.
        // biome-ignore lint/suspicious/noArrayIndexKey: derived blocks, no stable id
        <Fragment key={i}>{renderBlock(block, i)}</Fragment>
      ))}
    </>
  );
}

interface Block {
  kind: "h1" | "h2" | "h3" | "p";
  /** Raw inline markdown for this block. */
  text: string;
}

function splitBlocks(body: string): Block[] {
  const out: Block[] = [];
  // Split on blank lines (one or more empty lines).
  const chunks = body.split(/\n\s*\n/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const h1 = /^# (.+)$/s.exec(trimmed);
    if (h1) {
      out.push({ kind: "h1", text: h1[1] ?? "" });
      continue;
    }
    const h2 = /^## (.+)$/s.exec(trimmed);
    if (h2) {
      out.push({ kind: "h2", text: h2[1] ?? "" });
      continue;
    }
    const h3 = /^### (.+)$/s.exec(trimmed);
    if (h3) {
      out.push({ kind: "h3", text: h3[1] ?? "" });
      continue;
    }
    out.push({ kind: "p", text: trimmed });
  }
  return out;
}

function renderBlock(block: Block, key: number): JSX.Element {
  const inline = renderInline(block.text);
  switch (block.kind) {
    case "h1":
      return (
        <h1 key={key} className="text-base font-semibold leading-snug">
          {inline}
        </h1>
      );
    case "h2":
      return (
        <h2 key={key} className="text-sm font-semibold leading-snug">
          {inline}
        </h2>
      );
    case "h3":
      return (
        <h3 key={key} className="text-xs font-semibold uppercase tracking-wider leading-snug">
          {inline}
        </h3>
      );
    case "p":
      return (
        <p key={key} className="text-sm leading-snug">
          {inline}
        </p>
      );
  }
}

/**
 * Inline markdown: bold (`**x**`), italic (`*x*`), and `<br>` for single
 * newlines. Non-nesting — `**italic *inner* italic**` renders the outer
 * bold and the inner asterisks literal-ish. Good enough for v1.
 */
function renderInline(text: string): JSX.Element[] {
  // First pass: split on newlines into runs separated by <br>.
  const lines = text.split("\n");
  const out: JSX.Element[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    out.push(<Fragment key={`l${i}`}>{parseEmphasis(line)}</Fragment>);
    if (i < lines.length - 1) out.push(<br key={`br${i}`} />);
  }
  return out;
}

function parseEmphasis(line: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let i = 0;
  let textBuf = "";
  let key = 0;
  const flushText = () => {
    if (textBuf) {
      out.push(<Fragment key={`t${key++}`}>{textBuf}</Fragment>);
      textBuf = "";
    }
  };
  while (i < line.length) {
    // bold: **...**
    if (line[i] === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end !== -1) {
        flushText();
        out.push(
          <strong key={`b${key++}`} className="font-semibold">
            {line.slice(i + 2, end)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    // italic: *...*
    if (line[i] === "*") {
      const end = line.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1) {
        flushText();
        out.push(
          <em key={`i${key++}`} className="italic">
            {line.slice(i + 1, end)}
          </em>,
        );
        i = end + 1;
        continue;
      }
    }
    textBuf += line[i];
    i++;
  }
  flushText();
  return out;
}
