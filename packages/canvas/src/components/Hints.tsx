import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  dismissHints,
  HINTS,
  type Hint,
  type HintContext,
  hintsMode,
  type PlacedHint,
  placeHints,
  readHintsSeen,
} from "../hints.ts";
import { useCanvas } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { Kbd } from "./ui/kbd.tsx";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover.tsx";

/**
 * The first-run hints: a pinging dot on each part of the canvas worth
 * learning, opened by a click. What they say and the "dismissed" record are
 * in `hints.ts`; this is the drawing.
 */

/** How often the dots follow their targets: panes open, collapse and resize under them. */
const FOLLOW_MS = 400;

/** Loads which hints this person has dismissed, once a design is open. */
export function useHints(): void {
  const ready = useCanvas((s) => s.design !== null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!ready || loaded.current) return;
    loaded.current = true;
    const mode = hintsMode(window.location.search, navigator.webdriver === true);
    if (mode === "never") return;
    if (mode === "all") return useCanvas.getState().setHintsSeen([]);
    void readHintsSeen().then((seen) => useCanvas.getState().setHintsSeen(seen));
  }, [ready]);
}

export function Hints() {
  const seen = useCanvas((s) => s.hintsSeen);
  // The hints are about the board and its panes, which only the boards view has.
  const onBoard = useCanvas((s) => s.view === "boards");
  return seen && onBoard ? <HintDots seen={seen} /> : null;
}

function HintDots({ seen }: { seen: string[] }) {
  const comments = useCanvas(
    (s) =>
      s.rightTab === "comments" || s.pendingCommentAnchor !== null || s.commentThreads.length > 0,
  );
  const placed = usePlacedHints(seen, { comments });
  return (
    <>
      {placed.map((p) => (
        <HintDot key={p.hint.id} placed={p} />
      ))}
    </>
  );
}

/** The hints to show and where, followed as the layout changes. */
function usePlacedHints(seen: string[], context: HintContext): PlacedHint[] {
  const [placed, setPlaced] = useState<PlacedHint[]>(() => placeHints(seen, context));
  const { comments } = context;
  useEffect(() => {
    let last: string | null = null;
    const measure = () => {
      const next = placeHints(seen, { comments });
      const key = next.map((p) => `${p.hint.id}@${p.x},${p.y}`).join(" ");
      if (key === last) return;
      last = key;
      setPlaced(next);
    };
    measure();
    const timer = setInterval(measure, FOLLOW_MS);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [seen, comments]);
  return placed;
}

/** A hint's `**bold**` and `[[key]]` marks, drawn. */
function formatHintLine(line: string): ReactNode[] {
  // Keyed by where each part starts in the line, which is stable for a given hint.
  let at = 0;
  return line.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/).map((part) => {
    const i = at;
    at += part.length;
    if (part.startsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("[[")) {
      return (
        <Kbd key={i} className="border border-border bg-background text-foreground shadow-xs">
          {part.slice(2, -2)}
        </Kbd>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function HintDot({ placed }: { placed: PlacedHint }) {
  const { hint, x, y } = placed;
  const [open, setOpen] = useState(false);
  const setHintsSeen = useCanvas((s) => s.setHintsSeen);

  const dismiss = (hints: readonly Hint[]) => {
    const ids = hints.map((h) => h.id);
    const seen = useCanvas.getState().hintsSeen ?? [];
    setHintsSeen([...new Set([...seen, ...ids])]);
    void dismissHints(ids);
  };

  // The canvas's single-key shortcuts (V, H, C, [, ]…) listen on the window;
  // keys pressed in the card are the card's.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => e.stopPropagation();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`hint-${hint.id}`}
          aria-label={`Tip: ${hint.title}`}
          className="fixed z-40 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={{ left: x, top: y }}
        >
          <span
            aria-hidden="true"
            className="absolute inline-flex size-3.5 rounded-full bg-hint opacity-60 motion-safe:animate-ping"
          />
          <span
            aria-hidden="true"
            className="relative inline-flex size-2.5 rounded-full bg-hint ring-2 ring-background"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="hint-card"
        side={hint.side}
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="z-50 w-80 gap-3 border-t-2 border-t-hint p-4"
        onKeyDown={onKeyDown}
      >
        <PopoverHeader className="gap-1">
          <span className="text-[0.65rem] font-semibold tracking-wider text-hint uppercase">
            Tip
          </span>
          <PopoverTitle className="text-sm">{hint.title}</PopoverTitle>
          <div
            data-slot="popover-description"
            className="flex flex-col gap-1.5 text-[0.8rem] leading-relaxed text-muted-foreground"
          >
            {hint.body.split("\n").map((line) => (
              <p key={line}>{formatHintLine(line)}</p>
            ))}
          </div>
        </PopoverHeader>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto px-2 text-muted-foreground"
            data-testid="hint-hide-all"
            onClick={() => dismiss(HINTS)}
          >
            Hide all tips
          </Button>
          <Button
            size="sm"
            className="bg-hint text-hint-foreground hover:bg-hint/90"
            data-testid="hint-got-it"
            onClick={() => dismiss([hint])}
          >
            Got it
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
