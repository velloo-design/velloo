import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Kept in step with the inline transition the layout effect writes. */
const COLLAPSE_MS = 200;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

interface Props {
  open: boolean;
  /** Sizing and scrolling for the open, idle panel — flexbox owns it again there. */
  className?: string;
  "aria-disabled"?: boolean | undefined;
  children: React.ReactNode;
}

/**
 * A sidebar panel that slides shut instead of blinking out.
 *
 * Height is written in pixels for the length of the animation and then handed
 * straight back to flexbox, because an open panel here is flex-sized and
 * scrolls: its content height is the wrong number to interpolate towards (a
 * long boards list or a deep tree is several times the space it occupies). The
 * only right number is the height the layout had, which is why it's read on
 * every idle commit — by the time a close runs, the section around it has
 * already stopped stretching and the element no longer measures the same.
 *
 * Content unmounts once shut. These panels hold the two most expensive lists
 * in the app, and keeping a collapsed one rendered is the cost collapsing it
 * was meant to avoid.
 */
export function CollapsePanel({
  open,
  className = "",
  "aria-disabled": ariaDisabled,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const openHeight = useRef<number | null>(null);
  const [mounted, setMounted] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  const [animating, setAnimating] = useState(false);

  // Derived during render, not in an effect: the content has to be in the same
  // commit the layout effect measures, or the panel opens to a height of zero.
  if (wasOpen !== open) {
    const animate = !prefersReducedMotion();
    setWasOpen(open);
    setAnimating(animate);
    setMounted(open || animate);
  }

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.cssText = "";
    if (!animating) return;
    const from = open ? 0 : (openHeight.current ?? el.offsetHeight);
    const to = open ? el.offsetHeight : 0;
    el.style.flex = "0 0 auto";
    el.style.overflow = "hidden";
    el.style.height = `${from}px`;
    // Read back, so the write below is a transition and not a jump to `to`.
    void el.offsetHeight;
    el.style.transition = `height ${COLLAPSE_MS}ms ease-out`;
    el.style.height = `${to}px`;
  }, [animating, open]);

  // Every idle commit, after the effect above has handed the height back.
  useLayoutEffect(() => {
    if (!animating && open) openHeight.current = ref.current?.offsetHeight ?? null;
  });

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => {
      setAnimating(false);
      if (!open) setMounted(false);
    }, COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [animating, open]);

  if (!mounted) return null;

  return (
    <div ref={ref} className={className} aria-disabled={ariaDisabled}>
      {children}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;
}
