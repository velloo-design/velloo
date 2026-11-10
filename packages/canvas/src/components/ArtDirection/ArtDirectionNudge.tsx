import { ArrowRight } from "lucide-react";
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
      // The mark's own coral and amber, faint: the card is the one place the
      // Agent tab speaks for a feature rather than for the agent.
      className="relative flex gap-3 overflow-hidden rounded-xl border bg-gradient-to-br from-[#FF6F4D]/10 via-[#FFAB1F]/5 to-transparent p-3"
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
