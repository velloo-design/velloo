import { activeDirections, LOOKBOOK_STAGES, type LookbookStage } from "@velloo/schema";
import {
  BookImage,
  Compass,
  FileText,
  Hammer,
  LayoutTemplate,
  type LucideIcon,
  Palette,
} from "lucide-react";
import { useCanvas } from "../../store.ts";
import { Button } from "../ui/button.tsx";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";

const STEPS: Record<LookbookStage, { label: string; icon: LucideIcon }> = {
  brief: { label: "Brief", icon: FileText },
  directions: { label: "Directions", icon: Compass },
  boards: { label: "Mood boards", icon: Palette },
  mocks: { label: "Mocks", icon: LayoutTemplate },
  build: { label: "Build", icon: Hammer },
};

/** The step the person is on: the one they picked, else the lookbook's own stage. */
export function useLookbookStep(): LookbookStage {
  const picked = useCanvas((s) => s.lookbookStep);
  const stage = useCanvas((s) => s.lookbook?.lookbook.stage);
  return picked ?? stage ?? "brief";
}

/** The lookbook's steps down the left, each with where it stands. */
export function LookbookRail() {
  const state = useCanvas((s) => s.lookbook);
  const setStep = useCanvas((s) => s.setLookbookStep);
  const close = useCanvas((s) => s.closeLookbook);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const step = useLookbookStep();
  const lookbook = state?.lookbook;
  const reached = lookbook ? LOOKBOOK_STAGES.indexOf(lookbook.stage) : 0;
  const active = lookbook ? activeDirections(lookbook) : [];
  const picked = active.filter((d) => d.picked);
  const summaries: Record<LookbookStage, string> = {
    brief: lookbook?.brief ? lookbook.brief.page : "Not written yet",
    directions:
      lookbook && lookbook.directions.length > 0
        ? `${active.length} of ${lookbook.directions.length} in the running`
        : "None yet",
    boards: lookbook?.skipBoards
      ? "Skipped"
      : `${active.filter((d) => d.boards.length > 0).length} drawn`,
    mocks: `${picked.reduce((n, d) => n + d.mocks.length, 0)} drawn`,
    build: lookbook?.chosen ? "Mock chosen" : "Choose a mock first",
  };

  return (
    <aside
      data-lookbook-rail
      className="w-[280px] shrink-0 border-r bg-card flex flex-col min-h-0"
      inert={!wsConnected}
    >
      <header className="flex items-start gap-2.5 border-b p-3">
        <div className="size-8 grid place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
          <BookImage className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Lookbook</div>
          <p className="text-xs text-muted-foreground">
            Directions in pictures, narrowed to the one you build.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={close}>
          Close
        </Button>
      </header>
      <nav aria-label="Lookbook" className="flex flex-col gap-0.5 p-2">
        {LOOKBOOK_STAGES.map((id, i) => {
          const { label, icon: Icon } = STEPS[id];
          const locked = i > reached && !(id === "mocks" && lookbook?.skipBoards && reached >= 1);
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
                    className={step === id ? "size-4 text-primary" : "size-4 text-muted-foreground"}
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
      {lookbook && lookbook.requests.length > 0 ? (
        <div className="mx-3 rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {lookbook.requests.length} {lookbook.requests.length === 1 ? "ask" : "asks"} waiting
          </span>{" "}
          for your agent. It sees {lookbook.requests.length === 1 ? "it" : "them"} the next time it
          reads the lookbook.
        </div>
      ) : null}
    </aside>
  );
}
