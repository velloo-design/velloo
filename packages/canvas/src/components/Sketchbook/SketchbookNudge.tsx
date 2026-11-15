import type { LookSummary, SketchbookSummary } from "@velloo/protocol";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { FlowRow, SKETCHBOOK_FLOWS } from "./flows.tsx";
import { SketchbookMark } from "./SketchbookMark.tsx";

/**
 * The sketchbook a Look came from that is most worth going back to: the
 * newest one behind any of the design's Looks.
 */
function lookSketchbook(
  looks: LookSummary[] | null,
  books: SketchbookSummary[] | null,
): SketchbookSummary | undefined {
  const behind = new Set((looks ?? []).flatMap((l) => l.look?.origin?.sketchbook ?? []));
  return books?.find((b) => behind.has(b.id));
}

/**
 * The way into the sketchbook from the Agent tab: one entry under its mark,
 * with its two flows beneath it, each opening its start page. Once a Look
 * came from a sketchbook, carrying on in it comes first. Gone while the
 * sketchbook itself is open.
 */
export function SketchbookNudge() {
  const view = useCanvas((s) => s.view);
  const open = useCanvas((s) => s.openSketchbook);
  const start = useCanvas((s) => s.startSketchbook);
  const looks = useCanvas((s) => s.looks);
  const books = useCanvas((s) => s.sketchbooks);
  useEffect(() => {
    const s = useCanvas.getState();
    if (s.looks === null) void s.refreshLooks().catch(() => {});
    if (s.sketchbooks === null) void s.loadSketchbooks().catch(() => {});
  }, []);
  if (view === "sketchbook") return null;
  const resume = lookSketchbook(looks, books);
  return (
    <div className="flex flex-col gap-1">
      {resume ? (
        <Item
          asChild
          variant="outline"
          size="sm"
          className="cursor-pointer bg-background text-left hover:bg-muted/50"
        >
          <button
            type="button"
            data-sketchbook-nudge="continue"
            onClick={() =>
              void open(resume.id).catch((err) => toastError(err, "Could not open sketchbook"))
            }
          >
            <ItemMedia variant="icon">
              <SketchbookMark className="size-[18px]" />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>{`Continue “${resume.name}”`}</ItemTitle>
              <ItemDescription className="text-xs">
                Pick up the sketchbook your look came from.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </ItemActions>
          </button>
        </Item>
      ) : null}
      <Item
        variant="outline"
        size="sm"
        className="flex-col items-stretch gap-2 bg-background"
        data-sketchbook-nudge="sketchbook"
      >
        <ItemHeader className="justify-start gap-2.5">
          <SketchbookMark className="size-[18px] shrink-0" />
          <ItemContent className="min-w-0 gap-0">
            <ItemTitle>Sketchbook</ItemTitle>
            <ItemDescription className="text-xs">
              Directions in pictures, before your agent designs.
            </ItemDescription>
          </ItemContent>
        </ItemHeader>
        {SKETCHBOOK_FLOWS.map((f) => (
          <FlowRow
            key={f.subject}
            subject={f.subject}
            onPick={(subject) =>
              void start(subject).catch((err) => toastError(err, "Could not start a sketchbook"))
            }
          />
        ))}
      </Item>
    </div>
  );
}

/**
 * Above a conversation that runs a sketchbook, while the person is
 * elsewhere on the canvas (on the board it built, say): the way back to it.
 */
export function SketchbookLink({ sessionId }: { sessionId: string }) {
  const view = useCanvas((s) => s.view);
  const all = useCanvas((s) => s.sketchbooks);
  const open = useCanvas((s) => s.openSketchbook);
  useEffect(() => {
    if (useCanvas.getState().sketchbooks === null) {
      void useCanvas
        .getState()
        .loadSketchbooks()
        .catch(() => {});
    }
  }, []);
  const linked = all?.find((a) => a.agentSession === sessionId);
  if (!linked || view === "sketchbook") return null;
  return (
    <div
      data-sketchbook-link
      className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
    >
      <SketchbookMark className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Sketchbook · <span className="text-foreground">{linked.name}</span>
      </span>
      <Button
        variant="ghost"
        size="xs"
        onClick={() =>
          void open(linked.id).catch((err) => toastError(err, "Could not open sketchbook"))
        }
      >
        Open
        <ArrowRight />
      </Button>
    </div>
  );
}
