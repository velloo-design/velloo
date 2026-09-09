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

/**
 * The selection ring's colours, drawn inside the iframe.
 *
 * The parent draws the resize grips on top of a ring it doesn't own, so the two
 * have to agree on a colour. They used to disagree quietly — the grips reached
 * for the canvas app's `--color-primary`, which is velloo's orange, and landed
 * orange on a blue ring. Both sides read these instead.
 */
export const SELECT_RING = "#2563eb";
/** A snippet instance selects as a different kind of thing, so a different colour. */
export const SELECT_RING_SNIPPET = "#8b5cf6";
/** Hover is the same blue, one step lighter and one pixel thinner. */
export const HOVER_RING = "#60a5fa";

/** `window.postMessage` envelope that carries the MessageChannel port. */
export const INIT_MESSAGE_TYPE = "__velloo_init";

/**
 * Resolved CSS for one node, as `getComputedStyle` reports it.
 *
 * The HUD shows what a slot the node says nothing about actually resolves to —
 * the browser's 16px, the component's own padding — instead of a dash. Only
 * the iframe can answer that, since only it has the rendered element.
 */
export interface NodeComputed {
  path: string;
  values: Record<string, string>;
}

/** The properties the runtime reports for {@link NodeComputed}. */
export const COMPUTED_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "color",
  "backgroundColor",
  "borderTopWidth",
  "borderTopColor",
  "borderTopLeftRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "columnGap",
] as const;

export interface NodeRect {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Set when `path` addresses the focused snippet's *definition*, not a node in
   * the host tree. The two namespaces collide freely — "0.1" is a legal path in
   * both — so the parent keys them apart rather than merging them into one map.
   * One rect per rendered instance, so several can share a `path`.
   */
  snippet?: boolean;
}

export type ChildMessage =
  /** Handshake ack. `version` is absent in pre-versioning iframe docs. */
  | { type: "ready"; version?: number }
  /**
   * `snippetPath` is present only while the canvas has a snippet focused and
   * the click landed inside one of its instances. It addresses the node in the
   * *definition*, so an edit reaches every instance at once. Additive field.
   *
   * `instance` says WHICH instance was clicked, as an index into the same
   * outermost set `requestRects` measures. Every instance shows a selection
   * box, but only this one carries the resize grips — one obvious thing to
   * grab instead of eight handles per instance across the whole board.
   */
  | { type: "select"; path: string | null; snippetPath?: string; instance?: number }
  | { type: "hover"; path: string | null; snippetPath?: string }
  /** Double-click, offered as "edit what this is made of". */
  | { type: "enter"; path: string; snippetId?: string }
  /** Double-click outside the focused snippet — the way back out of the mode. */
  | { type: "exit" }
  | { type: "nodeRects"; rects: NodeRect[] }
  /**
   * Answer to `requestComputed`. Additive message — an older iframe doc simply
   * never sends it and the HUD falls back to showing nothing.
   */
  | { type: "nodeComputed"; computed: NodeComputed }
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
  | { type: "scrollPos"; x: number; y: number }
  /**
   * A keystroke the iframe has no use for. Clicking a node puts keyboard focus
   * inside the iframe document, where the parent's window listener never sees
   * it — so Escape and every other canvas shortcut died the moment you selected
   * something. Forwarded so the parent can dispatch it as its own.
   */
  | {
      type: "key";
      key: string;
      metaKey: boolean;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
    };

export type ParentMessage =
  /**
   * `scroll` additionally scrolls the node into view inside the iframe
   * document — set by search/reveal jumps, absent for plain click
   * selection (the clicked node is visible by definition). Additive
   * field, so no PROTOCOL_VERSION bump: older docs just don't scroll.
   */
  | {
      type: "applyHighlight";
      path: string;
      scroll?: boolean;
      /** Highlight every instance of this definition path instead of one node. */
      snippetPath?: string;
    }
  | { type: "clearHighlight" }
  | { type: "applyHover"; path: string; snippetPath?: string }
  | { type: "clearHover" }
  | {
      type: "applyVelloState";
      path: string | null;
      state: "default" | "hover" | "focus" | "active" | "disabled";
    }
  /**
   * `snippetPaths` addresses definition paths of the focused snippet, answered
   * with one rect per rendered instance (`NodeRect.snippet`). Selection chrome
   * needs it: while a snippet is focused the selection lives in that namespace,
   * so asking by node path alone measures nothing and the grips never appear.
   * Additive field — older docs simply report no snippet rects.
   */
  | { type: "requestRects"; paths: string[]; snippetPaths?: string[] }
  /** Ask for one node's resolved CSS — what the HUD shows in place of a dash. */
  | { type: "requestComputed"; path: string }
  /**
   * The board's zoom, so selection chrome stays a constant thickness on screen.
   * The ring is drawn in iframe pixels and the iframe is scaled by the board,
   * so at 500% a 2px ring became a 10px slab that swallowed the parent's resize
   * grips — which are zoom-constant. Additive; older docs keep the fixed ring.
   */
  | { type: "setChromeScale"; scale: number }
  /**
   * Scope the screen to one snippet: everything outside its instances dims and
   * stops taking clicks, and clicks inside report their definition path. `null`
   * leaves the mode.
   */
  | { type: "applySnippetFocus"; snippetId: string | null }
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
  "enter",
  "exit",
  "nodeRects",
  "nodeComputed",
  "parentZoom",
  "parentPan",
  "scrollPos",
  "key",
] as const;

export const PARENT_MESSAGE_TYPES = [
  "applyHighlight",
  "clearHighlight",
  "applyHover",
  "clearHover",
  "applyVelloState",
  "requestRects",
  "requestComputed",
  "setChromeScale",
  "applySnippetFocus",
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
