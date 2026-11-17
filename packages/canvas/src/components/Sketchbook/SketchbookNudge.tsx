import type { LookSummary, SketchbookSummary } from "@velloo/protocol";
import { ArrowRight, ChevronRight, Images, Palette } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { SketchbookMark } from "./SketchbookMark.tsx";

/** One way to start, as a row: what it does, said plainly. */
function StartRow({
  icon,
  title,
  body,
  onClick,
  data,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  data: string;
}) {
  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className="cursor-pointer bg-background text-left hover:bg-muted/50"
    >
      <button type="button" onClick={onClick} data-sketchbook-nudge={data}>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription className="text-xs">{body}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </ItemActions>
      </button>
    </Item>
  );
}

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
 * The ways into the sketchbook from the Agent tab, said as what they do
 * rather than sold: find a look for a page, explore palettes and type, and
 * once a Look came from a sketchbook, carry on in it. Gone while the
 * sketchbook itself is open.
 */
export function SketchbookNudge() {
  const view = useCanvas((s) => s.view);
  const open = useCanvas((s) => s.openSketchbook);
  const exploreLook = useCanvas((s) => s.exploreLook);
  const looks = useCanvas((s) => s.looks);
  const books = useCanvas((s) => s.sketchbooks);
  useEffect(() => {
    const s = useCanvas.getState();
    if (s.looks === null) void s.refreshLooks().catch(() => {});
    if (s.sketchbooks === null) void s.loadSketchbooks().catch(() => {});
  }, []);
  if (view === "sketchbook") return null;
  const failed = (err: unknown) => toastError(err, "Could not open sketchbook");
  const resume = lookSketchbook(looks, books);
  return (
    <div className="flex flex-col gap-1">
      {resume ? (
        <StartRow
          data="continue"
          icon={<SketchbookMark className="size-[18px]" />}
          title={`Continue “${resume.name}”`}
          body="Pick up the sketchbook your look came from."
          onClick={() => void open(resume.id).catch(failed)}
        />
      ) : null}
      <StartRow
        data="page"
        icon={
          resume ? <Images className="size-[18px]" /> : <SketchbookMark className="size-[18px]" />
        }
        title="Find a look"
        body="See a page as mood boards and mocks before designing it."
        onClick={() => void open().catch(failed)}
      />
      <StartRow
        data="look"
        icon={<Palette className="size-[18px]" />}
        title="Explore palettes & type"
        body="Try colours and fonts side by side, then keep one as a look."
        onClick={() =>
          void exploreLook().catch((err) => toastError(err, "Could not start a sketchbook"))
        }
      />
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
