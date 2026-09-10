/**
 * Side-pane width bounds, in px. The floor is where the inspector's label +
 * control rows stop fitting side by side; the ceiling keeps a pane from
 * crowding out the canvas on a laptop screen.
 *
 * Its own module, not the store's, because the pane frame is shared:
 * velloo-cloud's share viewer hangs its comments pane on the same PaneShell,
 * and must not drag the canvas store in to size it.
 */
export const PANE_WIDTH = { min: 240, max: 560, default: 320 } as const;

export function clampPaneWidth(px: number): number {
  return Math.min(PANE_WIDTH.max, Math.max(PANE_WIDTH.min, Math.round(px)));
}
