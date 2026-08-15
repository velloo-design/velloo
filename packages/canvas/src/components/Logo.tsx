/**
 * Velloo wordmark/mark. The geometry: a chamfered "V" rendered as two
 * tapering strokes with a single AI spark hovering in the negative space
 * — vellum-page surface meets the bright dot of generative intelligence.
 *
 * Renders cleanly at 16×16 (favicon) and at the top-bar size (≈24×24).
 */
interface Props {
  className?: string;
  size?: number;
  /** Override fill colors. Defaults inherit currentColor for the V, accent for the spark. */
  inkColor?: string;
  sparkColor?: string;
}

export function Logo({ className, size = 24, inkColor = "currentColor", sparkColor }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Velloo"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Velloo</title>
      {/* Soft parchment field — only visible when explicitly given a background. */}
      <rect x="0" y="0" width="32" height="32" rx="7" fill="none" />
      {/* V — two strokes meeting at the bottom, slight inward taper. */}
      <path d="M6 6 L13 23 L16 23 L9 6 Z" fill={inkColor} />
      <path d="M26 6 L19 23 L16 23 L23 6 Z" fill={inkColor} />
      {/* AI spark: a small four-pointed star above the V's apex. */}
      <path
        d="M22 7
           L23.6 9.4
           L26 11
           L23.6 12.6
           L22 15
           L20.4 12.6
           L18 11
           L20.4 9.4 Z"
        fill={sparkColor ?? "var(--primary, oklch(0.56 0.18 264))"}
      />
    </svg>
  );
}
