import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useCanvas } from "../store.ts";
import {
  availableTourSteps,
  findTourTarget,
  markTourSeen,
  readTourSeen,
  type TourPlacement,
  type TourStep,
  tourAutoStart,
} from "../tour.ts";
import { Button } from "./ui/button.tsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "./ui/popover.tsx";

/**
 * A short tour of the canvas: each step dims the window but for the thing it
 * talks about, with a card beside it. The steps and the "seen" record are in
 * `tour.ts`; this is the drawing and the keys.
 */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room between the target and the edge of the lit area. */
const HOLE_PAD = 4;
/** Keeps the lit area's ring inside the window when the target touches an edge. */
const EDGE = 2;

/** Opens the tour by itself the first time this person uses the canvas. */
export function useFirstRunTour(): void {
  const ready = useCanvas((s) => s.design !== null && s.view === "boards");
  const checked = useRef(false);
  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    const mode = tourAutoStart(window.location.search, navigator.webdriver === true);
    if (mode === "never") return;
    void (async () => {
      if (mode === "first-run" && (await readTourSeen())) return;
      useCanvas.getState().startTour();
    })();
  }, [ready]);
}

export function Tour() {
  const open = useCanvas((s) => s.tourOpen);
  return open ? <TourRun /> : null;
}

function TourRun() {
  const closeTour = useCanvas((s) => s.closeTour);
  // Fixed when the tour opens: a step skipped for want of a target stays
  // skipped, so the count doesn't change under the person mid-tour.
  const [steps] = useState(() => availableTourSteps());
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const target = useTargetBox(step);
  const titleId = useId();
  const bodyId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void markTourSeen();
  }, []);

  useEffect(() => {
    if (steps.length === 0) closeTour();
  }, [steps.length, closeTour]);

  // Back disappears on the first step; don't leave focus on nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per step on purpose
  useEffect(() => {
    if (!contentRef.current?.contains(document.activeElement)) nextRef.current?.focus();
  }, [index]);

  if (!step) return null;

  const last = index === steps.length - 1;
  const next = () => (last ? closeTour() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const hole = target ? holeBox(target, viewport) : null;
  const anchor = anchorFor(step.placement, hole, viewport);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The canvas's own single-key shortcuts (V, H, C, [, ]…) listen on the
    // window; while the tour has the keyboard, none of them should fire.
    e.stopPropagation();
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  };

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="tour-overlay"
        // Swallows clicks and wheel so the board can't move out from under
        // the card; the card's own Popover treats them as outside and stays.
        className="fixed inset-0 z-[60] pointer-events-auto"
      >
        {hole ? (
          <div
            data-testid="tour-spotlight"
            className="absolute rounded-lg ring-2 ring-primary shadow-[0_0_0_200vmax_rgb(0_0_0/0.45)] transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none dark:shadow-[0_0_0_200vmax_rgb(0_0_0/0.65)]"
            style={hole}
          />
        ) : (
          <div className="absolute inset-0 bg-black/45 dark:bg-black/65" />
        )}
      </div>
      <Popover open modal>
        <PopoverAnchor asChild>
          <div aria-hidden="true" className="pointer-events-none fixed" style={anchor.box} />
        </PopoverAnchor>
        <PopoverContent
          ref={contentRef}
          data-testid="tour-card"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          side={anchor.side}
          align={anchor.align}
          sideOffset={12}
          collisionPadding={12}
          // The anchor moves with the target (a pane collapsing, the window
          // resizing), which nothing else would tell the card about.
          updatePositionStrategy="always"
          className="z-[61] w-80 gap-3 p-4"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nextRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            closeTour();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onKeyDown={onKeyDown}
        >
          <PopoverHeader aria-live="polite" className="gap-1">
            <PopoverTitle id={titleId} className="text-sm">
              {step.title}
            </PopoverTitle>
            <PopoverDescription id={bodyId} className="text-[0.8rem] leading-relaxed">
              {step.body}
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex items-center gap-1.5">
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">
              {index + 1} of {steps.length}
            </span>
            {last ? null : (
              <Button variant="ghost" size="sm" onClick={closeTour} data-testid="tour-skip">
                Skip tour
              </Button>
            )}
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={back} data-testid="tour-back">
                Back
              </Button>
            ) : null}
            <Button ref={nextRef} size="sm" onClick={next} data-testid="tour-next">
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

/**
 * Where the step's target is right now, followed through window resizes and
 * the target's own (a pane collapsing to its rail). Null when it has gone off
 * screen since the tour opened — the card then sits mid-window.
 */
function useTargetBox(step: TourStep | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!step) return;
    let observed: HTMLElement | null = null;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    function measure() {
      if (!step) return;
      const el = findTourTarget(step);
      if (el !== observed) {
        observer?.disconnect();
        if (el) observer?.observe(el);
        observed = el;
      }
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [step]);
  return box;
}

function holeBox(r: Box, viewport: { width: number; height: number }): Box {
  const left = Math.max(r.left - HOLE_PAD, EDGE);
  const top = Math.max(r.top - HOLE_PAD, EDGE);
  const right = Math.min(r.left + r.width + HOLE_PAD, viewport.width - EDGE);
  const bottom = Math.min(r.top + r.height + HOLE_PAD, viewport.height - EDGE);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

interface Anchor {
  box: Box;
  side: "top" | "right" | "bottom" | "left";
  align: "start" | "center";
}

function anchorFor(
  placement: TourPlacement,
  hole: Box | null,
  viewport: { width: number; height: number },
): Anchor {
  if (!hole) {
    return {
      box: { left: viewport.width / 2, top: viewport.height / 3, width: 0, height: 0 },
      side: "bottom",
      align: "center",
    };
  }
  switch (placement) {
    case "inside":
      // A target as big as the board has no "beside" on screen; the card
      // sits in its upper middle instead.
      return {
        box: {
          left: hole.left + hole.width / 2,
          top: hole.top + Math.min(hole.height / 4, 120),
          width: 0,
          height: 0,
        },
        side: "bottom",
        align: "center",
      };
    case "right":
    case "left":
      // A pane is as tall as the window: point at its top, where its tabs are.
      return {
        box: { ...hole, height: Math.min(hole.height, 160) },
        side: placement,
        align: "start",
      };
    case "bottom":
      return { box: hole, side: "bottom", align: "center" };
  }
}
