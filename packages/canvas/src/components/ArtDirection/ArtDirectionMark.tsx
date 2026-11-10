/**
 * The art direction's mark: Velloo's two interlinked frames, the second one
 * redrawn as a quick pencil loop that overshoots its start. Drawn by hand
 * (the frame wobbles, the loop isn't round) because the step is the hand-drawn
 * part of a design; in the logo's coral and amber, and woven the same way, so
 * it reads as Velloo's at 16px.
 */
const FRAME =
  "M36 21 C 48 19, 62 20, 70 21 C 77 22, 80 27, 80 35 C 80 46, 80 56, 79 65 C 78 74, 73 78, 65 79 C 53 80, 42 80, 34 79 C 26 78, 22 73, 21 65 C 20 54, 21 44, 22 35 C 23 26, 28 22, 36 21 Z";
const LOOP =
  "M96 66 C 100 84, 88 100, 70 100 C 52 100, 41 87, 42 72 C 43 55, 57 43, 73 44 C 88 45, 99 54, 101 64 C 101 68, 98 70, 93 66";

export function ArtDirectionMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden
      data-art-direction-mark
      strokeWidth="11"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <clipPath id="art-direction-weave">
          <rect x="50" y="30" width="42" height="34" />
        </clipPath>
      </defs>
      <path d={FRAME} stroke="#FF6F4D" />
      <path d={LOOP} stroke="#FFAB1F" />
      <path d={FRAME} stroke="#FF6F4D" clipPath="url(#art-direction-weave)" />
    </svg>
  );
}
