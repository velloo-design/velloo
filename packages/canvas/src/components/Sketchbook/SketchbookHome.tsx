import type { SketchbookSummary } from "@velloo/protocol";
import { useEffect } from "react";
import { SKETCHBOOK_STEP_LABELS } from "../../sketchbook-steps.ts";
import { isLiveSession } from "../../store/agent.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Badge } from "../ui/badge.tsx";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";
import { FlowRow, flowTitle, SKETCHBOOK_FLOWS } from "./flows.tsx";
import { SketchbookMark } from "./SketchbookMark.tsx";

const newestFirst = (a: SketchbookSummary, b: SketchbookSummary) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/** One sketchbook to pick up again: what it explores, where it stands, whether its agent is up. */
function SketchbookRow({ book, running }: { book: SketchbookSummary; running: boolean }) {
  const open = useCanvas((s) => s.openSketchbook);
  return (
    <Item asChild variant="outline" className="cursor-pointer p-3 text-left hover:bg-muted/50">
      <button
        type="button"
        data-sketchbook-item={book.id}
        onClick={() =>
          void open(book.id).catch((err) => toastError(err, "Could not open the sketchbook"))
        }
      >
        <ItemMedia variant="image" className="size-14">
          {book.cover ? (
            <img src={`/${book.cover}`} alt="" loading="lazy" className="object-cover" />
          ) : (
            <div className="grid size-full place-items-center bg-muted">
              <SketchbookMark className="size-7 opacity-40" />
            </div>
          )}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full">
            <span className="min-w-0 truncate">{book.name}</span>
            {running ? (
              <Badge variant="secondary" className="ml-auto shrink-0" data-sketchbook-running>
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
                Agent running
              </Badge>
            ) : null}
          </ItemTitle>
          <ItemDescription className="text-xs">
            {flowTitle(book.subject)} · {SKETCHBOOK_STEP_LABELS[book.stage]}
            {book.images > 0 ? ` · ${book.images} ${book.images === 1 ? "image" : "images"}` : ""}
          </ItemDescription>
          {book.updatedAt ? (
            <ItemDescription className="text-[11px]">
              {new Date(book.updatedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </ItemDescription>
          ) : null}
        </ItemContent>
      </button>
    </Item>
  );
}

/**
 * The sketchbook with none open: the two ways to start one, then the
 * sketchbooks already started, the newest first, to pick one up again.
 */
export function SketchbookHome() {
  const books = useCanvas((s) => s.sketchbooks);
  const sessions = useCanvas((s) => s.agentSessions);
  const start = useCanvas((s) => s.startSketchbook);
  useEffect(() => {
    // Which sketchbooks have their agent up is read from the Agent tab's sessions.
    const s = useCanvas.getState();
    if (s.agentProviders === null) void s.loadAgent().catch(() => {});
  }, []);
  const live = new Set(sessions.filter(isLiveSession).map((s) => s.id));
  const sorted = [...(books ?? [])].sort(newestFirst);
  return (
    <div className="flex-1 overflow-y-auto p-10" data-sketchbook-home>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <SketchbookMark className="size-10" />
          <h1 className="text-2xl font-semibold tracking-tight">See it before you build it</h1>
          <p className="text-sm text-muted-foreground">
            Your agent writes a brief and three directions, each with its colours and type. You
            narrow them down, see them drawn by image models, and the ones you choose become the
            looks and screens your agent designs.
          </p>
        </div>
        <section className="flex flex-col gap-2" aria-label="Start a sketchbook">
          <h2 className="text-sm font-medium">What do you want to do?</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {SKETCHBOOK_FLOWS.map((f) => (
              <FlowRow
                key={f.subject}
                subject={f.subject}
                className="h-full"
                onPick={(subject) =>
                  void start(subject).catch((err) =>
                    toastError(err, "Could not start a sketchbook"),
                  )
                }
              />
            ))}
          </div>
        </section>
        {sorted.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Your sketchbooks">
            <h2 className="text-sm font-medium">Your sketchbooks</h2>
            <div className="flex flex-col gap-2">
              {sorted.map((b) => (
                <SketchbookRow
                  key={b.id}
                  book={b}
                  running={b.agentSession !== null && live.has(b.agentSession)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
