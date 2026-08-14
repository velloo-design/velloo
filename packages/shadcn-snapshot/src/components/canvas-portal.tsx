/**
 * Canvas-safe portal contract.
 *
 * Radix primitives portal their "open" content to `document.body` so it
 * stacks above page chrome. In design mode that's a problem: a Dialog
 * preview that lives in the body is invisible inside the canvas iframe,
 * and any styling pinned to a transformed ancestor breaks the math.
 *
 * The Velloo contract: render the content **inline** under the
 * component itself, never through a portal. We don't actually want
 * users clicking the dropdown shut in design mode — they want to see
 * the styled state at all times. So:
 *
 *   <Dialog>
 *     <DialogTrigger>Open</DialogTrigger>
 *     <DialogContent>…</DialogContent>   ← rendered inline, always visible
 *   </Dialog>
 *
 * Implementation:
 *
 *   1. The Velloo wrapper for each Radix root forces `open={true}` /
 *      `defaultOpen={true}` in design mode so Radix actually mounts
 *      Content (otherwise Content is conditional on open state).
 *   2. The Velloo `Content` ditches Radix's `Portal` wrapper — it
 *      renders the styled card with the same data-slot attribute that
 *      shadcn ships, so user-app TSX (which imports the real shadcn
 *      components) keeps the same look.
 *
 * Real apps that ingest the agent's `emit_code` output ignore this
 * file and import the real shadcn primitives. The Velloo snapshot is
 * design-mode-only.
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
