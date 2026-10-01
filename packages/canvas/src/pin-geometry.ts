/**
 * Where markers sit on a frame — comment pins and attached-note markers alike,
 * so the two land and stack the same way. Shared by velloo-cloud's share
 * viewer through `components/comment-pin.tsx`.
 *
 * Markers counter-scale out of the board zoom (`--canvas-zoom`), so any length
 * meant in screen px has to be divided by it at paint time — hence CSS
 * `calc`/`clamp` strings rather than numbers.
 */

/** Half a marker's size (`size-7`), in screen px. */
const PIN_RADIUS = 14;

/** `PIN_RADIUS` in board units, resolved at paint time. */
const PIN_INSET = `(${PIN_RADIUS}px / var(--canvas-zoom, 1))`;

/**
 * A board-unit coordinate held a marker's radius inside `[low, high]`, so a
 * marker on a frame's edge stays on the frame — off its header and its ⋯ menu.
 * Matches the JS reading when the frame is narrower than a marker: `low` wins.
 */
export function clampInsideFrame(value: number, low: number, high: number): string {
  return `clamp(${low}px + ${PIN_INSET}, ${value}px, ${high}px - ${PIN_INSET})`;
}

/** How far each marker in a pile sits from the one before it, in screen px. */
const PILE_STEP = 18;

/**
 * Markers on the same spot fan out leftward, into the node, like a facepile:
 * each one partly covers the last, so every one of them can still be hovered.
 * `index` 0 sits on the spot itself. Use as the CSS `translate` of an element
 * that is centred on the spot and counter-scaled about its own centre.
 */
export function pileTranslate(index: number): string {
  return `calc(-50% - ${index * PILE_STEP}px / var(--canvas-zoom, 1)) -50%`;
}

/** Two markers are in the same pile when they resolve to the same spot. */
export function pileKey(position: { left: string; top: string }): string {
  return `${position.left}|${position.top}`;
}
