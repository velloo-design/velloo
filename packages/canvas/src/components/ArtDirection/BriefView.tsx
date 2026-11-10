import { ART_DIRECTION_LIMITS } from "@velloo/protocol";
import type { ArtDirectionBrief } from "@velloo/schema";
import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The brief as a reader takes it in: the product and the page beside the
 * page's copy, set out the way the agent wrote it. A line that is only a
 * bracketed name ("[HERO]") starts a section; "[Image: …]" is a picture the
 * page shows; any other bracket is a note about the copy, not copy.
 */

type Block =
  | { kind: "section"; text: string }
  | { kind: "image"; text: string }
  | { kind: "note"; text: string }
  | { kind: "line"; text: string }
  | { kind: "gap" };

const SECTION = /^\[([A-Z0-9][A-Z0-9 &/,'’-]*)\]$/;
const PICTURE =
  /^\[(?:image|photo|photograph|illustration|picture|figure|video|logo)\s*:\s*(.+)\]$/i;
const NOTE = /^\[(.+)\]$/;

function blocks(content: string): Block[] {
  const out: Block[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (out.length > 0 && out.at(-1)?.kind !== "gap") out.push({ kind: "gap" });
      continue;
    }
    const section = SECTION.exec(line);
    if (section) {
      out.push({ kind: "section", text: section[1] ?? line });
      continue;
    }
    const picture = PICTURE.exec(line);
    if (picture) {
      out.push({ kind: "image", text: picture[1] ?? line });
      continue;
    }
    const note = NOTE.exec(line);
    out.push(note ? { kind: "note", text: note[1] ?? line } : { kind: "line", text: line });
  }
  return out;
}

/** Brackets inside a line of copy ("Vitrine [existing logo]") read as notes. */
function withNotes(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\])/).map((part, i) =>
    /^\[[^\]]+\]$/.test(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one line, in a fixed order.
      <span key={i} className="rounded bg-primary/10 px-1 py-px text-[0.9em] text-primary">
        {part.slice(1, -1)}
      </span>
    ) : (
      part
    ),
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "section":
      return (
        <h3 className="mt-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary first:mt-0">
          {block.text}
          <span aria-hidden className="h-px flex-1 bg-border" />
        </h3>
      );
    case "image":
      return (
        <figure className="my-1 flex items-start gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <ImageIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <figcaption>{block.text}</figcaption>
        </figure>
      );
    case "note":
      return <p className="mt-2 text-xs font-medium text-primary">{block.text}</p>;
    case "line":
      return <p>{withNotes(block.text)}</p>;
    case "gap":
      return <div aria-hidden className="h-2" />;
  }
}

function Copy({ content }: { content: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm leading-relaxed">
      {blocks(content).map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one text, in order.
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

/** "2,941 / 2,800" once a field is over what an image prompt can carry. */
function Over({ field, value }: { field: keyof typeof ART_DIRECTION_LIMITS; value: string }) {
  const limit = ART_DIRECTION_LIMITS[field];
  if (value.length <= limit) return null;
  return (
    <p className="text-xs text-destructive">
      {value.length.toLocaleString()} of {limit.toLocaleString()} characters: shorten it before
      drawing, or the image models can't take it.
    </p>
  );
}

export function BriefView({ brief }: { brief: ArtDirectionBrief }) {
  return (
    // Side by side once the step itself is wide enough: beside a wide Agent
    // tab the window is no guide to the room the copy has.
    <div className="@container">
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,300px)_1fr] @3xl:gap-8">
        <aside className="flex flex-col gap-5 @3xl:sticky @3xl:top-0">
          <div className="flex flex-col gap-1">
            <Label>The page</Label>
            <p className="text-lg font-semibold leading-snug tracking-tight">{brief.page}</p>
            <Over field="page" value={brief.page} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>The product</Label>
            <p className="text-[15px] leading-relaxed">{brief.product}</p>
            <Over field="product" value={brief.product} />
          </div>
          {brief.notes.trim() ? (
            <div className="flex flex-col gap-1">
              <Label>Notes</Label>
              <p className="text-sm leading-relaxed text-muted-foreground">{brief.notes}</p>
              <Over field="notes" value={brief.notes} />
            </div>
          ) : null}
        </aside>
        <article className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Its copy, top to bottom</Label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {brief.content.length.toLocaleString()} /{" "}
              {ART_DIRECTION_LIMITS.content.toLocaleString()}
            </span>
          </div>
          <Over field="content" value={brief.content} />
          {brief.content.trim() ? (
            <Copy content={brief.content} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No copy yet: the mocks invent their own words until there is.
            </p>
          )}
        </article>
      </div>
    </div>
  );
}
