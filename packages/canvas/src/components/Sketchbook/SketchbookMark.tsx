/**
 * The sketchbook's mark: half of Velloo's rounded frame drawn, the other
 * half a painter's palette with three wells, and a brush laid along the split,
 * through the gaps at both corners. Amber for the drawing, coral for the paint:
 * the logo's pair, swapped. The wells are cut out, so they show whatever is
 * behind the mark in either theme.
 */
const FRAME_HALF = "M21 74 L21 43 A22 22 0 0 1 43 21 L74 21";
const PALETTE = "M99 33 L99 77 A22 22 0 0 1 77 99 L33 99 Z";
const WELLS: [number, number, number][] = [
  [85, 63, 6.5],
  [76, 76, 5.5],
  [63, 85, 4.5],
];
const BRISTLES = "M82 53.5 C 94 51, 106 55.5, 115 60 C 106 64.5, 94 69, 82 66.5 Z";

const AMBER = "#FFAB1F";
const CORAL = "#FF6F4D";

/** The drawn half's length: two 31-unit runs and a quarter of a 22-unit circle. */
const FRAME_LENGTH = 98;

/**
 * The mark at work, for a wait of a few seconds or more: the frame draws
 * itself in, the brush works along the split and dabs paint into the wells
 * one by one, then the frame lets go and it starts over. Slow on purpose, so
 * it reads as calm rather than as a spinner; with reduced motion it is the
 * still mark.
 */
const WORKING_CSS = `
@keyframes sketchbook-mark-frame {
  0% { stroke-dashoffset: ${FRAME_LENGTH}; }
  24% { stroke-dashoffset: 0; }
  80% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -${FRAME_LENGTH}; }
}
@keyframes sketchbook-mark-brush {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(-5px); }
}
@keyframes sketchbook-mark-dab {
  0%, 30% { transform: scale(0); opacity: 0; }
  40%, 82% { transform: scale(1); opacity: 1; }
  94%, 100% { transform: scale(0); opacity: 0; }
}
.sketchbook-mark-frame {
  stroke-dasharray: ${FRAME_LENGTH};
  animation: sketchbook-mark-frame 7.2s ease-in-out infinite backwards;
}
.sketchbook-mark-brush {
  animation: sketchbook-mark-brush 3.6s ease-in-out infinite;
}
.sketchbook-mark-dab {
  transform-box: fill-box;
  transform-origin: center;
  animation: sketchbook-mark-dab 7.2s ease-in-out infinite backwards;
}
@media (prefers-reduced-motion: reduce) {
  .sketchbook-mark-frame, .sketchbook-mark-brush { animation: none; stroke-dashoffset: 0; }
  .sketchbook-mark-dab { display: none; }
}
`;

export function SketchbookMark({
  className,
  animated = false,
}: {
  className?: string | undefined;
  /** At work: for a wait, such as the agent writing the brief. */
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden
      data-sketchbook-mark={animated ? "animated" : ""}
    >
      {animated ? (
        <style href="sketchbook-mark-working" precedence="default">
          {WORKING_CSS}
        </style>
      ) : null}
      <defs>
        {/* Identical wherever the mark is drawn, so a shared id is harmless. */}
        <mask id="sketchbook-wells" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <rect width="120" height="120" fill="#fff" />
          {WELLS.map(([cx, cy, r]) => (
            <circle key={cx} cx={cx} cy={cy} r={r} fill="#000" />
          ))}
        </mask>
      </defs>
      <path
        d={FRAME_HALF}
        className={animated ? "sketchbook-mark-frame" : undefined}
        stroke={AMBER}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={PALETTE}
        fill={CORAL}
        stroke={CORAL}
        strokeWidth="5"
        strokeLinejoin="round"
        mask="url(#sketchbook-wells)"
      />
      {animated
        ? WELLS.map(([cx, cy, r], i) => (
            <circle
              key={cx}
              className="sketchbook-mark-dab"
              style={{ animationDelay: `${0.45 * i}s` }}
              cx={cx}
              cy={cy}
              r={r - 1.5}
              fill={AMBER}
            />
          ))
        : null}
      <g transform="rotate(-45 60 60)" fill={AMBER}>
        <g className={animated ? "sketchbook-mark-brush" : undefined}>
          <line
            x1="8"
            y1="60"
            x2="76"
            y2="60"
            stroke={AMBER}
            strokeWidth="6.5"
            strokeLinecap="round"
          />
          <rect x="74" y="54.5" width="9" height="11" rx="2.5" />
          <path d={BRISTLES} />
        </g>
      </g>
    </svg>
  );
}
