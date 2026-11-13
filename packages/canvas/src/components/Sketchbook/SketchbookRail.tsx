import {
  activeDirections,
  latestOf,
  PAGE_IMAGE_KINDS,
  SKETCHBOOK_STAGES,
  type SketchbookStage,
  sketchbookName,
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
import { SKETCHBOOK_STEP_LABELS } from "../../sketchbook-steps.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Button } from "../ui/button.tsx";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";
import { chosenWords } from "./chosen.ts";
import { SketchbookMark } from "./SketchbookMark.tsx";

const ICONS: Record<SketchbookStage, LucideIcon> = {
  brief: FileText,
  directions: Compass,
  boards: Palette,
  mocks: LayoutTemplate,
  screens: Monitor,
};

/** The step the person is on: the one they picked, else the sketchbook's own stage. */
export function useSketchbookStep(): SketchbookStage {
  const picked = useCanvas((s) => s.sketchbookStep);
  const stage = useCanvas((s) => s.sketchbook?.sketchbook.stage);
  return picked ?? stage ?? "brief";
}

/** The sketchbook's steps down the left, each with where it stands. */
export function SketchbookRail() {
  const state = useCanvas((s) => s.sketchbook);
  const setStep = useCanvas((s) => s.setSketchbookStep);
  const close = useCanvas((s) => s.closeSketchbook);
  const remove = useCanvas((s) => s.deleteSketchbook);
  const open = useCanvas((s) => s.openSketchbook);
  const id = useCanvas((s) => s.sketchbookId);
  const others = useCanvas((s) => s.sketchbooks?.length ?? 0);
  const [confirming, setConfirming] = useState(false);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const step = useSketchbookStep();
  const sketchbook = state?.sketchbook;
  const reached = sketchbook ? SKETCHBOOK_STAGES.indexOf(sketchbook.stage) : 0;
  const active = sketchbook ? activeDirections(sketchbook) : [];
  const picked = active.filter((d) => d.picked);
  const summaries: Record<SketchbookStage, string> = {
    brief: sketchbook?.brief ? sketchbook.brief.page : "Not written yet",
    directions:
      sketchbook && sketchbook.directions.length > 0
        ? `${active.length} of ${sketchbook.directions.length} in the running`
        : "None yet",
    boards: sketchbook?.skipBoards
      ? "Skipped"
      : `${active.filter((d) => latestOf(d, "moodboard")).length} drawn`,
    mocks: `${picked.reduce((n, d) => n + d.images.filter((i) => PAGE_IMAGE_KINDS.includes(i.kind)).length, 0)} drawn`,
    screens: sketchbook?.chosen.length ? `From ${chosenWords(sketchbook)}` : "Choose images first",
  };

  return (
    <aside
      data-sketchbook-rail
      className="w-[280px] shrink-0 border-r bg-card flex flex-col min-h-0"
      inert={!wsConnected}
    >
      <header className="flex items-start gap-2.5 border-b p-3">
        <SketchbookMark className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Sketchbook</div>
          <p
            className="truncate text-xs text-muted-foreground"
            title={sketchbook ? sketchbookName(sketchbook) : undefined}
          >
            {sketchbook && id
              ? sketchbookName(sketchbook)
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
            All sketchbooks
          </Button>
        </div>
      ) : null}
      {id ? (
        <nav aria-label="Sketchbook" className="flex flex-col gap-0.5 p-2">
          {SKETCHBOOK_STAGES.map((id, i) => {
            const label = SKETCHBOOK_STEP_LABELS[id];
            const Icon = ICONS[id];
            const locked =
              i > reached && !(id === "mocks" && sketchbook?.skipBoards && reached >= 1);
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
            Delete this sketchbook
          </Button>
        </footer>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title="Delete this sketchbook?"
        description="Its brief, its directions and every mood board and mock drawn for them are deleted from the design folder. Your other sketchbooks, and the screens your agent designed, stay."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirming(false);
          void remove().catch((err) => toastError(err, "Could not delete the sketchbook"));
        }}
        onCancel={() => setConfirming(false)}
      />
    </aside>
  );
}
