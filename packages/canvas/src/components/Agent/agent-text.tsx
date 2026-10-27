import { Fragment, type JSX, type ReactNode } from "react";
import { safeHref } from "../../markdown/parse.ts";

/**
 * What a coding agent writes: paragraphs, lists, headings, fenced code and
 * inline code, bold and links. The comment `Markdown` deliberately stays
 * smaller (its editor round-trips every construct it renders); an agent's
 * answer is read-only and leans on code spans, so it gets its own reader.
 */

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; lang: string; text: string };

export function parseAgentText(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] as string))
        body.push(lines[i++] as string);
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: "h", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const last = blocks.at(-1);
      if (last && last.kind === kind) last.items.push(item[1] ?? "");
      else blocks.push({ kind, items: [item[1] ?? ""] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Inline runs: `code`, **bold**, *italic*, [links](https://…). */
function renderInlineAgentText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    if (match[1] !== undefined) {
      out.push(
        <code key={key++} className="rounded-sm bg-muted px-1 font-mono text-xs">
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      out.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      out.push(<em key={key++}>{match[3]}</em>);
    } else {
      const href = safeHref(match[5] ?? "");
      out.push(
        href ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {match[4]}
          </a>
        ) : (
          match[4]
        ),
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AgentText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={`flex min-w-0 flex-col gap-2 wrap-break-word ${className}`} data-agent-text>
      {parseAgentText(text).map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived from the text and have no identity
        <Fragment key={i}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: Block): JSX.Element {
  switch (block.kind) {
    case "p":
      return <p className="whitespace-pre-wrap">{renderInlineAgentText(block.text)}</p>;
    case "h": {
      const Heading = block.level <= 2 ? "h3" : "h4";
      return (
        <Heading className={block.level <= 2 ? "font-semibold" : "font-medium"}>
          {renderInlineAgentText(block.text)}
        </Heading>
      );
    }
    case "ul":
    case "ol": {
      const List = block.kind;
      return (
        <List
          className={`flex flex-col gap-1 pl-4 marker:text-muted-foreground ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}
        >
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items are derived from the text
            <li key={i}>{renderInlineAgentText(item)}</li>
          ))}
        </List>
      );
    }
    case "code":
      return (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed">
          <code>{block.text}</code>
        </pre>
      );
  }
}
