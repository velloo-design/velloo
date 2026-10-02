/**
 * Ctrl+wheel — which is also how Chrome and Firefox deliver a trackpad pinch —
 * zooms the whole page unless something cancels it. The board cancels it over
 * itself and zooms the canvas instead; this cancels it everywhere else, so the
 * panes and header never scale. Safari reports a pinch as its own gesture
 * events rather than a wheel.
 */
export function blockPageZoom(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  const onGesture = (e: Event) => e.preventDefault();
  window.addEventListener("wheel", onWheel, { passive: false });
  for (const type of SAFARI_GESTURES) document.addEventListener(type, onGesture);
  return () => {
    window.removeEventListener("wheel", onWheel);
    for (const type of SAFARI_GESTURES) document.removeEventListener(type, onGesture);
  };
}

const SAFARI_GESTURES = ["gesturestart", "gesturechange"] as const;
