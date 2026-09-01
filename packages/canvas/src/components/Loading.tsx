/**
 * Animated loading indicator built from the velloo mark — the two interlinked
 * rounded frames trace themselves in (coral leading amber), hold, then erase.
 * SVG + CSS only, no JS timers, so it costs nothing while a design loads.
 *
 * Ported verbatim to velloo-cloud (web/src/components/Loading.tsx), the same
 * convention Logo.tsx follows. Keep the copies identical — the loader is brand
 * surface and has to look the same in the editor and in the share viewer.
 */
import { useId } from "react";

/** Perimeter of a 58×58 frame at rx 20: four 18px runs + one 20px-radius circle. */
const RING = 198;

const LOADING_CSS = `
@keyframes velloo-loading-trace {
  0% { stroke-dashoffset: ${RING}; }
  40% { stroke-dashoffset: 0; }
  60% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -${RING}; }
}
.velloo-loading-ring {
  stroke-dasharray: ${RING};
  /* backwards: amber's delay would otherwise show it fully drawn for 180ms
     before the trace starts, popping on every mount. */
  animation: velloo-loading-trace 1.6s ease-in-out infinite backwards;
}
.velloo-loading-ring-amber { animation-delay: 0.18s; }
@media (prefers-reduced-motion: reduce) {
  .velloo-loading-ring {
    animation: none;
    stroke-dasharray: none;
    stroke-dashoffset: 0;
  }
}
`;

/**
 * The animated mark on its own. Reads well from ~16px (inline, in a panel
 * header) up to hero sizes; 40-48px suits a full-surface boot state.
 */
export function LoadingMark({ size = 22, className }: { size?: number; className?: string }) {
  // Each instance clips its own weave: duplicate SVG ids across simultaneously
  // mounted loaders (a board full of pending frames) resolve to whichever one
  // happens to be first in the document.
  const weaveId = `velloo-loading-weave-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <>
      <style href="velloo-loading" precedence="default">
        {LOADING_CSS}
      </style>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        className={className}
        fill="none"
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <clipPath id={weaveId}>
            <rect x="52" y="30" width="38" height="35" />
          </clipPath>
        </defs>
        <rect
          className="velloo-loading-ring"
          x="21"
          y="21"
          width="58"
          height="58"
          rx="20"
          stroke="#FF6F4D"
          strokeWidth="11"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <rect
          className="velloo-loading-ring velloo-loading-ring-amber"
          x="41"
          y="41"
          width="58"
          height="58"
          rx="20"
          stroke="#FFAB1F"
          strokeWidth="11"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Coral back over amber at the top crossing, in phase with its own
            ring so the weave holds through the whole trace. */}
        <rect
          className="velloo-loading-ring"
          x="21"
          y="21"
          width="58"
          height="58"
          rx="20"
          stroke="#FF6F4D"
          strokeWidth="11"
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath={`url(#${weaveId})`}
        />
      </svg>
    </>
  );
}

/**
 * The mark plus an optional caption, centred. The caption inherits the
 * surrounding text size and colour so it sits in whatever surface hosts it.
 */
export function Loading({
  label,
  size,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2${className ? ` ${className}` : ""}`}
    >
      <LoadingMark size={size} />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}
