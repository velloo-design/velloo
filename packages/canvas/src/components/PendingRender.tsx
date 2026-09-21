import { LoadingMark } from "./Loading.tsx";

/**
 * Covers an iframe whose document hasn't painted yet. An iframe mid-navigation
 * is a bare white rectangle — on a board that reads as a screen that rendered
 * empty, and on a dark canvas as a hole — so hold the velloo mark over it
 * until the render arrives.
 */
export function PendingRender({
  size = 28,
  label,
  counterZoom = false,
}: {
  size?: number | undefined;
  label?: string | undefined;
  /**
   * Board frames are drawn inside the canvas zoom transform, which would
   * shrink the mark to a speck when zoomed out and blow it up when zoomed in.
   * Scale it back so it stays the same size on screen, as the frame chrome does.
   */
  counterZoom?: boolean | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Under the resize handles and over both buffers; transparent to the
      // pointer so a loading frame behaves exactly like a loaded one (hand-mode
      // panning, marquee) rather than swallowing the gesture.
      className="absolute inset-0 z-10 grid place-items-center rounded-md border bg-card text-xs text-muted-foreground pointer-events-none"
    >
      <div
        className="flex flex-col items-center gap-2"
        style={counterZoom ? { transform: "scale(calc(1 / var(--canvas-zoom, 1)))" } : undefined}
      >
        <LoadingMark size={size} />
        {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
      </div>
    </div>
  );
}
