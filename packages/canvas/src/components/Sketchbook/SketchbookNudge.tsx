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
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { SketchbookMark } from "./SketchbookMark.tsx";

/**
 * The way into the sketchbook from the Agent tab: one row among the ways
 * to start, said as what it does rather than sold, and gone while the sketchbook
 * itself is open.
 */
export function SketchbookNudge() {
  const view = useCanvas((s) => s.view);
  const open = useCanvas((s) => s.openSketchbook);
  if (view === "sketchbook") return null;
  const go = () => void open().catch((err) => toastError(err, "Could not open sketchbook"));
  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className="cursor-pointer bg-background text-left hover:bg-muted/50"
    >
      <button type="button" onClick={go} data-sketchbook-nudge>
        <ItemMedia variant="icon">
          <SketchbookMark className="size-[18px]" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>Sketchbook</ItemTitle>
          <ItemDescription className="text-xs">
            See a page's look as mood boards and mocks before designing it.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </ItemActions>
      </button>
    </Item>
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
