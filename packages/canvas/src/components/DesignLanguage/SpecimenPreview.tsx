import { useEffect, useRef, useState } from "react";
import { type SpecimenScheme, specimenSrc } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { type ScrollPos, useDoubleBuffer } from "../Frame/useDoubleBuffer.ts";
import { useIframeOverrides } from "../Frame/useIframeOverrides.ts";
import { PendingRender } from "../PendingRender.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

type Show = SpecimenScheme | "both";

/** The width the specimen is laid out at; a narrower pane scales it down rather than reflowing it. */
const SPECIMEN_WIDTH = 1120;

/**
 * The specimen: the design language on the design's own components. It is the
 * stage's subject, not a board — nothing here can be selected or edited, and
 * it appears in no board list. What it shows is whatever the theme says now.
 */
export function SpecimenPreview() {
  const scheme = useCanvas((s) => s.languageScheme);
  const setScheme = useCanvas((s) => s.setLanguageScheme);
  const hasDark = useCanvas((s) => Boolean(s.theme?.colorsDark));
  // "Both" is this pane's own; either single scheme is the stage's, shared
  // with the role editor so the palette on show is the one being edited.
  const [both, setBoth] = useState(false);
  const show: Show = both ? "both" : scheme;
  const schemes: SpecimenScheme[] = both ? ["light", "dark"] : [scheme];

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <span className="text-xs font-medium">Specimen</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          This design's own components, drawn with the language as it stands. Read-only.
        </span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="ml-auto"
          value={show}
          onValueChange={(v) => {
            if (v === "both") setBoth(true);
            else if (v === "light" || v === "dark") {
              setBoth(false);
              setScheme(v);
            }
          }}
        >
          <ToggleGroupItem value="light" className="text-xs">
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="text-xs">
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="both" className="text-xs">
            Both
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!hasDark && show !== "light" ? (
        <p className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          This theme has no dark palette yet, so dark renders as light. A starting point or a seed
          colour gives it one.
        </p>
      ) : null}
      <div className="flex-1 min-h-0 flex gap-4 p-4">
        {schemes.map((scheme) => (
          <SpecimenFrame key={scheme} scheme={scheme} />
        ))}
      </div>
    </div>
  );
}

function SpecimenFrame({ scheme }: { scheme: SpecimenScheme }) {
  const themeVersion = useCanvas((s) => s.themeVersion);
  const src = specimenSrc(scheme, themeVersion);
  const savedScroll = useRef<ScrollPos | null>(null);
  const { srcs, front, painted, slotRefs, settleSlot } = useDoubleBuffer(src, savedScroll);
  // The same live previews a board frame gets: a face being browsed or a
  // rhythm control mid-drag paints here before it is committed.
  useIframeOverrides({
    slotRefs,
    front,
    screenRev: themeVersion,
    hasScreen: true,
    frontIsCurrent: srcs[front] === src,
  });

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: SPECIMEN_WIDTH, h: 800 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const report = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, size.w / SPECIMEN_WIDTH);

  return (
    <div
      ref={box}
      data-specimen={scheme}
      className="relative flex-1 min-w-0 overflow-hidden rounded-md bg-white ring-1 ring-border"
    >
      {([0, 1] as const).map((slot) =>
        srcs[slot] === null ? null : (
          <iframe
            key={slot}
            ref={slotRefs[slot]}
            title={`Specimen, ${scheme}${slot === front ? "" : " — loading"}`}
            src={srcs[slot] as string}
            aria-hidden={slot === front ? undefined : true}
            onLoad={() => {
              // Remembered so a re-render after a theme edit opens where this one was scrolled.
              const win = slotRefs[slot].current?.contentWindow;
              win?.addEventListener("scroll", () => {
                savedScroll.current = { x: win.scrollX, y: win.scrollY };
              });
              settleSlot(slot);
            }}
            className={`absolute left-0 top-0 origin-top-left border-0${slot === front ? "" : " invisible"}`}
            style={{
              width: size.w / scale,
              height: size.h / scale,
              transform: scale === 1 ? undefined : `scale(${scale})`,
            }}
          />
        ),
      )}
      {painted ? null : <PendingRender />}
    </div>
  );
}
