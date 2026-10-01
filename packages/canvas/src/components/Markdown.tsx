import { Fragment, type JSX } from "react";
import { groupBullets, type Inline, type Line, parseMarkdown } from "../markdown/parse.ts";

/**
 * The look of written markdown — notes, annotations, comments — applied from
 * the container, so the read-only renderer below and the live editor
 * (`RichMarkdownEditor`) set the same elements the same way. It lives here
 * because velloo-cloud's Tailwind scans this file for the share viewer.
 */
export const MARKDOWN_PROSE =
  "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:tracking-tight " +
  "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:tracking-tight " +
  "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wider " +
  "[&_strong]:font-semibold [&_b]:font-semibold [&_em]:italic [&_i]:italic " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_li]:pl-0.5 [&_li]:marker:text-current/60 " +
  "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-current/40 whitespace-pre-wrap break-words";

/**
 * Read-only markdown: headings, bold, italic and links (see `parseMarkdown`).
 * One source line is one line on screen, blank ones included, exactly as the
 * editor shows it — so finishing an edit changes nothing but the caret.
 */
export function Markdown({
  body,
  className = "",
}: {
  body: string;
  className?: string | undefined;
}): JSX.Element {
  return (
    <div className={`${MARKDOWN_PROSE} ${className}`} data-markdown>
      {groupBullets(parseMarkdown(body)).map((group, i) =>
        // Lines are derived from the body and have no identity of their own;
        // the whole list re-renders when the body changes anyway.
        Array.isArray(group) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: derived lines, no stable id
          <ul key={i}>
            {group.map((line, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: derived lines, no stable id
              <li key={j}>{line.inline.length > 0 ? renderInline(line.inline) : <br />}</li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: derived lines, no stable id
          <Fragment key={i}>{renderLine(group)}</Fragment>
        ),
      )}
    </div>
  );
}

function renderLine(line: Line): JSX.Element {
  const content = line.inline.length > 0 ? renderInline(line.inline) : <br />;
  switch (line.kind) {
    case "h1":
      return <h1>{content}</h1>;
    case "h2":
      return <h2>{content}</h2>;
    case "h3":
      return <h3>{content}</h3>;
    case "p":
    case "li":
      return <div>{content}</div>;
  }
}

function renderInline(nodes: Inline[]): JSX.Element[] {
  return nodes.map((node, i) => (
    // Runs are derived from the body and have no identity of their own.
    // biome-ignore lint/suspicious/noArrayIndexKey: derived runs, no stable id
    <Fragment key={i}>{renderNode(node)}</Fragment>
  ));
}

function renderNode(node: Inline): JSX.Element | string {
  if (node.kind === "text") return node.text;
  const children = renderInline(node.children);
  if (node.kind === "link") {
    return (
      <a href={node.href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return node.kind === "strong" ? <strong>{children}</strong> : <em>{children}</em>;
}
