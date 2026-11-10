import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { ArtDirectionMark } from "./ArtDirectionMark.tsx";

/**
 * The way into the art direction from the Agent tab, for someone about to ask
 * their agent for a redesign in words: a card above the agents, gone while
 * the art direction itself is open.
 */
export function ArtDirectionNudge() {
  const view = useCanvas((s) => s.view);
  const open = useCanvas((s) => s.openArtDirection);
  if (view === "art-direction") return null;
  const go = () => void open().catch((err) => toastError(err, "Could not open art direction"));
  return (
    <section
      data-art-direction-nudge
      aria-label="Art direction"
      // The mark's own coral and teal, faint: the card is the one place the
      // Agent tab speaks for a feature rather than for the agent.
      className="relative flex gap-3 overflow-hidden rounded-xl border bg-gradient-to-br from-[#FF6F4D]/10 via-[#14B8A6]/5 to-transparent p-3"
    >
      <ArtDirectionMark className="size-9 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <h2 className="text-sm font-semibold leading-tight">Redesigning? See it first.</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Art direction turns a brief into three directions, mood boards and full-page mocks. Your
          agent builds the one you pick, with your components.
        </p>
        <Button size="xs" className="mt-0.5" onClick={go}>
          Start art direction
          <ArrowRight />
        </Button>
      </div>
    </section>
  );
}

/**
 * Above a conversation that runs an art direction, while the person is
 * elsewhere on the canvas (on the board it built, say): the way back to it.
 */
export function ArtDirectionLink({ sessionId }: { sessionId: string }) {
  const view = useCanvas((s) => s.view);
  const all = useCanvas((s) => s.artDirections);
  const open = useCanvas((s) => s.openArtDirection);
  useEffect(() => {
    if (useCanvas.getState().artDirections === null) {
      void useCanvas
        .getState()
        .loadArtDirections()
        .catch(() => {});
    }
  }, []);
  const linked = all?.find((a) => a.agentSession === sessionId);
  if (!linked || view === "art-direction") return null;
  return (
    <div
      data-art-direction-link
      className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
    >
      <ArtDirectionMark className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Art direction · <span className="text-foreground">{linked.name}</span>
      </span>
      <Button
        variant="ghost"
        size="xs"
        onClick={() =>
          void open(linked.id).catch((err) => toastError(err, "Could not open art direction"))
        }
      >
        Open
        <ArrowRight />
      </Button>
    </div>
  );
}
