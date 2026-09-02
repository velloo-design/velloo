import type { TypesetRole, TypesetScale } from "@velloo/schema/typeset";

/**
 * Four rungs of the resolved ladder. The point of deriving a scale from three
 * controls is that you never author these numbers — so the panel has to say
 * what the drag actually produced, or the controls are unreadable.
 *
 * Four and not ten: the rail is 320px, and the ten-rung specimen is what the
 * dialog-scale workbench would exist for.
 */
const SHOWN: TypesetRole[] = ["h1", "h3", "body", "caption"];

/** Largest rung the rail can show without the row heights running away. */
const SPECIMEN_CAP_PX = 26;

export function LadderReadout({ scale, rootPx }: { scale: TypesetScale; rootPx: number }) {
  // Scale the whole specimen by one factor rather than clamping each rung:
  // clamping flattens h1 and h3 onto the same size and hides the very ratio
  // the readout exists to show.
  const largest = Math.max(...SHOWN.map((role) => scale[role].fontSize));
  const fit = Math.min(1, SPECIMEN_CAP_PX / largest);
  return (
    <div className="rounded-md border bg-background px-2.5 py-2">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Resolved ladder
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
          {`at ${rootPx}px base`}
        </span>
      </div>
      {SHOWN.map((role, i) => {
        const rung = scale[role];
        return (
          <div
            key={role}
            className={`flex items-baseline gap-3 py-1.5${i === SHOWN.length - 1 ? "" : " border-b"}`}
          >
            <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">
              {role}
            </span>
            <span
              className="truncate text-foreground"
              style={{
                fontSize: rung.fontSize * fit,
                lineHeight: 1,
                letterSpacing: rung.letterSpacing,
                fontWeight: rung.fontWeight,
                ...(rung.fontFamily ? { fontFamily: rung.fontFamily } : {}),
              }}
            >
              Aa
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
              {`${rung.fontSize} / ${rung.lineHeight.toFixed(2)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
