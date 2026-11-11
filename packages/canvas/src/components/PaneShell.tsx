import { useEffect, useRef, useState } from "react";
import { PaneResizer } from "./PaneResizer.tsx";

/** Wide enough for a 32px icon button plus the pane's border. */
export const PANE_RAIL_WIDTH = 36;

/** Kept in step with the `duration-200` class below. */
const COLLAPSE_MS = 200;

interface Props {
  side: "left" | "right";
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  /** Shown in place of the content once the pane has finished collapsing. */
  rail: React.ReactNode;
  /** Dim and disable the content — never the rail or the resize handle. */
  contentDisabled?: boolean | undefined;
  children: React.ReactNode;
}

/**
 * The frame around a side pane: it owns the width, the collapse animation and
 * the resize handle, so the panes themselves only supply content and a rail.
 *
 * The animation is width-only, and the content is held at its full width and
 * *clipped* on the way out rather than reflowed — a tree or an inspector
 * squeezing through 36px would be far louder than the movement itself. So the
 * rail is only mounted once the pane has finished narrowing, and on the way
 * back the content mounts full-width behind the widening edge. Content stays
 * unmounted while collapsed: these two panes are the expensive part of the app.
 */
export function PaneShell({
  side,
  collapsed,
  width,
  onResize,
  rail,
  contentDisabled = false,
  children,
}: Props) {
  const animating = useChangeAnimation(collapsed);
  // A width set from outside (the art direction widening the Agent tab) eases
  // to its place like a collapse does. A drag ends on the width it already
  // shows, so its commit has nothing to animate.
  const widening = useChangeAnimation(width);
  const moving = animating || widening;
  const paneRef = useRef<HTMLElement | null>(null);

  return (
    <aside
      ref={paneRef}
      data-pane={side}
      data-collapsed={collapsed}
      style={{ width: collapsed ? PANE_RAIL_WIDTH : width }}
      className={
        "relative h-full shrink-0 overflow-hidden bg-card " +
        (side === "left" ? "border-r " : "border-l ") +
        // Only while collapsing or expanding: a resize drag writes the width
        // straight to this element, and a transition would leave the edge
        // lagging behind the cursor.
        (moving ? "transition-[width] duration-200 ease-out" : "")
      }
    >
      {collapsed && !animating ? (
        rail
      ) : (
        <>
          {collapsed ? null : (
            <PaneResizer side={side} width={width} onCommit={onResize} paneRef={paneRef} />
          )}
          <div
            // Pinned to the pane's outer edge so a collapse looks like the
            // content sliding off-screen. Fixed width for the length of the
            // animation, then handed back to the pane so a drag reflows it.
            style={{ width: collapsed || moving ? width : "100%" }}
            className={
              `absolute inset-y-0 flex flex-col ${side === "left" ? "left-0" : "right-0"} ` +
              (contentDisabled ? "opacity-50 pointer-events-none select-none" : "")
            }
            aria-disabled={contentDisabled || undefined}
          >
            {children}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * True for the length of a collapse, expand or width change. Deliberately
 * derived during render rather than in an effect: the transition class has to
 * land in the same commit as the new width, or the pane snaps to it before the
 * class arrives and there is nothing left to animate.
 */
function useChangeAnimation<T>(value: T): boolean {
  const reduced = usePrefersReducedMotion();
  const [previous, setPrevious] = useState(value);
  const [animating, setAnimating] = useState(false);

  if (previous !== value) {
    setPrevious(value);
    setAnimating(!reduced);
  }

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => setAnimating(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [animating]);

  return animating;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
