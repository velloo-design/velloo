/**
 * Message contract between the canvas (parent) and the design-iframe
 * runtime (child). The runtime is a raw JS string (iframe-runtime.ts)
 * that can't be type-checked against these unions, so three guards keep
 * the two sides honest:
 *
 *   - the *_MESSAGE_TYPES arrays are runtime mirrors of the unions,
 *     pinned to them by the compile-time assertions at the bottom;
 *   - __tests__/iframe-protocol.test.ts greps the runtime source for
 *     message literals and fails when either side drifts;
 *   - the handshake carries PROTOCOL_VERSION (interpolated into the
 *     runtime string at build time), so a stale iframe document fails
 *     loudly instead of silently mis-communicating.
 *
 * Bump PROTOCOL_VERSION whenever a message shape changes incompatibly.
 */
export const PROTOCOL_VERSION = 1;

/** `window.postMessage` envelope that carries the MessageChannel port. */
export const INIT_MESSAGE_TYPE = "__velloo_init";

export interface NodeRect {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ChildMessage =
  /** Handshake ack. `version` is absent in pre-versioning iframe docs. */
  | { type: "ready"; version?: number }
  | { type: "select"; path: string | null }
  | { type: "hover"; path: string | null }
  | { type: "nodeRects"; rects: NodeRect[] }
  /**
   * Cmd/Ctrl+wheel inside the iframe. clientX/Y are in the iframe
   * document coordinates — the parent translates them into board
   * coords using the iframe's bounding rect so zoom anchors on
   * the actual cursor position, not (0,0).
   */
  | { type: "parentZoom"; deltaY: number; clientX: number; clientY: number }
  /**
   * Plain wheel / trackpad-scroll inside the iframe. The board uses
   * this to pan the canvas; without it the iframe absorbs the scroll
   * silently and the user can't move when their cursor is over a frame.
   */
  | { type: "parentPan"; deltaX: number; deltaY: number }
  /**
   * Debounced report of the document's scroll offset. The parent keeps the
   * last value per frame and restores it after the iframe reloads (theme
   * toggle, theme edit, resize commit) via `restoreScroll`. Additive
   * message — older iframe docs simply never send it, no version bump.
   */
  | { type: "scrollPos"; x: number; y: number };

export type ParentMessage =
  /**
   * `scroll` additionally scrolls the node into view inside the iframe
   * document — set by search/reveal jumps, absent for plain click
   * selection (the clicked node is visible by definition). Additive
   * field, so no PROTOCOL_VERSION bump: older docs just don't scroll.
   */
  | { type: "applyHighlight"; path: string; scroll?: boolean }
  | { type: "clearHighlight" }
  | { type: "applyHover"; path: string }
  | { type: "clearHover" }
  | {
      type: "applyVelloState";
      path: string | null;
      state: "default" | "hover" | "focus" | "active" | "disabled";
    }
  | { type: "requestRects"; paths: string[] }
  /**
   * Restore a previously reported scroll offset after a reload. Sent from
   * the parent's onReady handler unless a reveal jump is pending (the
   * reveal's scrollIntoView must win). Additive — older docs ignore it.
   */
  | { type: "restoreScroll"; x: number; y: number };

export const CHILD_MESSAGE_TYPES = [
  "ready",
  "select",
  "hover",
  "nodeRects",
  "parentZoom",
  "parentPan",
  "scrollPos",
] as const;

export const PARENT_MESSAGE_TYPES = [
  "applyHighlight",
  "clearHighlight",
  "applyHover",
  "clearHover",
  "applyVelloState",
  "requestRects",
  "restoreScroll",
] as const;

// Compile-time pins: each array contains only union members, and no
// union member is missing from its array.
type AssertNever<T extends never> = T;
const _childTypesValid: readonly ChildMessage["type"][] = CHILD_MESSAGE_TYPES;
const _parentTypesValid: readonly ParentMessage["type"][] = PARENT_MESSAGE_TYPES;
// Exported so the completeness pins survive `noUnusedLocals`, which flags an
// unused *type* the way it flags an unused value — and a `void` reference can
// only silence the value half.
export type ChildComplete = AssertNever<
  Exclude<ChildMessage["type"], (typeof CHILD_MESSAGE_TYPES)[number]>
>;
export type ParentComplete = AssertNever<
  Exclude<ParentMessage["type"], (typeof PARENT_MESSAGE_TYPES)[number]>
>;
void _childTypesValid;
void _parentTypesValid;
