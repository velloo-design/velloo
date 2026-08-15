/**
 * Canvas-safe portal contract — the heart of the adapter pattern.
 *
 * Radix primitives portal their "open" content to `document.body` so it
 * stacks above page chrome. Inside Velloo's canvas iframes, a portal to
 * the body is invisible (the iframe's body has nothing for the design
 * to attach to), and any styling pinned to a transformed ancestor breaks
 * the math.
 *
 * The Velloo contract: render the content **inline** under the
 * component itself, never through a portal. We don't actually want users
 * clicking the dropdown shut in design mode — they want to see the
 * styled state at all times. So:
 *
 *   <Dialog>
 *     <DialogTrigger>Open</DialogTrigger>
 *     <DialogContent>...</DialogContent>   ← rendered inline, always visible
 *   </Dialog>
 *
 * Implementation:
 *
 *   1. The Velloo Root for each Radix-shaped component forces
 *      `open={true}` / `defaultOpen={true}` in design mode so Radix
 *      mounts Content (otherwise Content is conditional on open state).
 *   2. The Velloo `Content` ditches Radix's `Portal` wrapper — it
 *      renders the styled card with the same data-slot attribute that
 *      shadcn ships, so user-app CSS still targets it normally.
 *
 * The user's real app imports unmodified shadcn from their own
 * `components/ui/<name>.tsx` (fetched at `velloo init` from upstream)
 * and gets the actual modal behavior. The canvas-only adapter is what
 * lets the *canvas* render those modals inline.
 *
 * See `docs/decisions.md` #18 (snapshot stays design-mode only) and
 * #25 (upstream provider + adapter layer).
 */
import type * as React from "react";

/**
 * Decide whether a Radix root should pin `open=true` in design mode.
 * If the consumer explicitly set `open` or `defaultOpen`, respect it.
 * Otherwise pin open so Content renders.
 */
export function pinOpenInDesignMode<Props extends { open?: boolean; defaultOpen?: boolean }>(
  props: Props,
): Props {
  if (props.open !== undefined || props.defaultOpen !== undefined) return props;
  return { ...props, open: true };
}

/**
 * Helper: spread the relevant `data-state` / aria attributes onto an
 * inline-rendered Content so user-app shadcn CSS still styles it.
 */
export function inlineOpenAttrs(): { "data-state": "open"; "data-velloo-inline": "true" } {
  return { "data-state": "open", "data-velloo-inline": "true" };
}

export type CanvasInline<T> = React.PropsWithChildren<T & { className?: string }>;
