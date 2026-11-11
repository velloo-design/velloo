/**
 * The art direction's mark: half of Velloo's rounded frame drawn, the other
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

export function ArtDirectionMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden
      data-art-direction-mark
    >
      <defs>
        {/* Identical wherever the mark is drawn, so a shared id is harmless. */}
        <mask
          id="art-direction-wells"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="120"
          height="120"
        >
          <rect width="120" height="120" fill="#fff" />
          {WELLS.map(([cx, cy, r]) => (
            <circle key={cx} cx={cx} cy={cy} r={r} fill="#000" />
          ))}
        </mask>
      </defs>
      <path
        d={FRAME_HALF}
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
        mask="url(#art-direction-wells)"
      />
      <g transform="rotate(-45 60 60)" fill={AMBER}>
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
    </svg>
  );
}
