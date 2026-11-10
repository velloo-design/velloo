import { ArrowRight } from "lucide-react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { ArtDirectionMark } from "./ArtDirectionMark.tsx";

/**
 * A quiet way into the art direction from the Agent tab, for someone about to
 * ask their agent for a redesign in words: one line, gone while the art
 * direction itself is open.
 */
export function ArtDirectionNudge({ className }: { className?: string | undefined }) {
  const view = useCanvas((s) => s.view);
  const open = useCanvas((s) => s.openArtDirection);
  if (view === "art-direction") return null;
  return (
    <button
      type="button"
      data-art-direction-nudge
      onClick={() => void open().catch((err) => toastError(err, "Could not open art direction"))}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground ${className ?? ""}`}
    >
      <ArtDirectionMark className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Redesigning?</span> See it first: directions,
        mood boards and page mocks with art direction.
      </span>
      <ArrowRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
