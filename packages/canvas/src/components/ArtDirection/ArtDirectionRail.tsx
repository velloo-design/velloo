import {
  ART_DIRECTION_STAGES,
  type ArtDirectionStage,
  activeDirections,
  artDirectionName,
} from "@velloo/schema";
import {
  ChevronLeft,
  Compass,
  FileText,
  LayoutTemplate,
  type LucideIcon,
  Monitor,
  Palette,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { ART_DIRECTION_STEP_LABELS } from "../../art-direction-steps.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Button } from "../ui/button.tsx";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";
import { ArtDirectionMark } from "./ArtDirectionMark.tsx";
import { chosenWords } from "./chosen.ts";

const ICONS: Record<ArtDirectionStage, LucideIcon> = {
  brief: FileText,
  directions: Compass,
  boards: Palette,
  mocks: LayoutTemplate,
  screens: Monitor,
};

/** The step the person is on: the one they picked, else the art direction's own stage. */
export function useArtDirectionStep(): ArtDirectionStage {
  const picked = useCanvas((s) => s.artDirectionStep);
  const stage = useCanvas((s) => s.artDirection?.artDirection.stage);
  return picked ?? stage ?? "brief";
}

/** The art direction's steps down the left, each with where it stands. */
export function ArtDirectionRail() {
  const state = useCanvas((s) => s.artDirection);
  const setStep = useCanvas((s) => s.setArtDirectionStep);
  const close = useCanvas((s) => s.closeArtDirection);
  const remove = useCanvas((s) => s.deleteArtDirection);
  const open = useCanvas((s) => s.openArtDirection);
  const id = useCanvas((s) => s.artDirectionId);
  const others = useCanvas((s) => s.artDirections?.length ?? 0);
  const [confirming, setConfirming] = useState(false);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const step = useArtDirectionStep();
  const artDirection = state?.artDirection;
  const reached = artDirection ? ART_DIRECTION_STAGES.indexOf(artDirection.stage) : 0;
  const active = artDirection ? activeDirections(artDirection) : [];
  const picked = active.filter((d) => d.picked);
  const summaries: Record<ArtDirectionStage, string> = {
    brief: artDirection?.brief ? artDirection.brief.page : "Not written yet",
    directions:
      artDirection && artDirection.directions.length > 0
        ? `${active.length} of ${artDirection.directions.length} in the running`
        : "None yet",
    boards: artDirection?.skipBoards
      ? "Skipped"
      : `${active.filter((d) => d.boards.length > 0).length} drawn`,
    mocks: `${picked.reduce((n, d) => n + d.mocks.length, 0)} drawn`,
    screens: artDirection?.chosen.length
      ? `From ${chosenWords(artDirection)}`
      : "Choose images first",
  };

  return (
    <aside
      data-art-direction-rail
      className="w-[280px] shrink-0 border-r bg-card flex flex-col min-h-0"
      inert={!wsConnected}
    >
      <header className="flex items-start gap-2.5 border-b p-3">
        <ArtDirectionMark className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Art direction</div>
          <p
            className="truncate text-xs text-muted-foreground"
            title={artDirection ? artDirectionName(artDirection) : undefined}
          >
            {artDirection && id
              ? artDirectionName(artDirection)
              : "Directions in pictures, narrowed to what you build."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={close}>
          Close
        </Button>
      </header>
      {id && others > 0 ? (
        <div className="border-b p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => void open(null)}
          >
            <ChevronLeft />
            All art directions
          </Button>
        </div>
      ) : null}
      {id ? (
        <nav aria-label="Art direction" className="flex flex-col gap-0.5 p-2">
          {ART_DIRECTION_STAGES.map((id, i) => {
            const label = ART_DIRECTION_STEP_LABELS[id];
            const Icon = ICONS[id];
            const locked =
              i > reached && !(id === "mocks" && artDirection?.skipBoards && reached >= 1);
            return (
              <Item
                key={id}
                asChild
                size="xs"
                variant={step === id ? "muted" : "default"}
                className="cursor-pointer text-left hover:bg-muted/50 disabled:cursor-default disabled:opacity-50"
              >
                <button
                  type="button"
                  disabled={locked}
                  aria-current={step === id ? "step" : undefined}
                  onClick={() => setStep(id)}
                >
                  <ItemMedia>
                    <Icon
                      className={
                        step === id ? "size-4 text-primary" : "size-4 text-muted-foreground"
                      }
                    />
                  </ItemMedia>
                  <ItemContent className="gap-0">
                    <ItemTitle className="text-[13px]">{label}</ItemTitle>
                    <ItemDescription className="text-[11px]">{summaries[id]}</ItemDescription>
                  </ItemContent>
                </button>
              </Item>
            );
          })}
        </nav>
      ) : null}
      <div className="flex-1" />
      {id && state ? (
        <footer className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
            Delete this art direction
          </Button>
        </footer>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Delete this art direction?"
        description="Its brief, its directions and every mood board and mock drawn for them are deleted from the design folder. Your other art directions, and the screens your agent designed, stay."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirming(false);
          void remove().catch((err) => toastError(err, "Could not delete the art direction"));
        }}
        onCancel={() => setConfirming(false)}
      />
    </aside>
  );
}
