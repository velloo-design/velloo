/**
 * Containment for a component that throws while rendering.
 *
 * A design tree is composed freely, so it can hold shapes a component refuses:
 * most often a part placed without the ancestor whose context it reads (Radix
 * answers that with a throw). One such node used to fail the whole server
 * render, so `/api/render/:screenId` answered 500 and the canvas drew an empty
 * frame — no clue which node, and the rest of a working screen lost with it.
 *
 * React cannot contain this for us. An error boundary recovers on the client
 * only: under `renderToString` a throw propagates straight out, and the
 * streaming renderer reports it to `onError` and then rethrows too. The one
 * server-side recovery React offers is a Suspense boundary, which resolves to
 * "switched to client rendering" — it would wrap every node in boundary markers
 * and emit the stack into the markup, and a static design never does the client
 * pass that repairs it.
 *
 * So the containment is ours: render, and if a component throws, name it, swap
 * it for a visible stand-in and render again. The happy path is untouched — no
 * wrapper elements, no extra markup, and nothing to pay until something breaks.
 */
import type { ComponentRegistry } from "@velloo/provider";
import { createElement, type ReactElement } from "react";

/** A component that threw, and was replaced by a stand-in for this render. */
export interface RenderFailure {
  /** Registry id of the component that threw. */
  componentId: string;
  /** The thrown message, shown in the stand-in and carried to the caller. */
  reason: string;
}

export interface GuardedRender {
  html: string;
  /** Empty on a clean render. One entry per component replaced. */
  failures: RenderFailure[];
}

/**
 * A screen holding more distinct broken components than this is not worth
 * re-rendering through one at a time; the caller gets the error instead.
 */
const MAX_STAND_INS = 8;

/**
 * Name the component whose render threw by walking the error's stack for the
 * innermost frame that a registry knows. React calls function components
 * directly, so the component's own frame sits between the throw and React's
 * internals: `at useContext / at SelectTrigger / at renderWithHooks`.
 *
 * Reading the stack rather than React's component stack is what keeps the fast
 * path on `renderToString`, whose thrown error carries no component stack of
 * its own — the alternative is rendering everything twice through the
 * streaming renderer to get one.
 */
function blame(error: unknown, registry: ComponentRegistry): string | null {
  if (!(error instanceof Error) || typeof error.stack !== "string") return null;
  for (const match of error.stack.matchAll(/^\s*at ([A-Za-z0-9_$]+)/gm)) {
    const name = match[1];
    if (name !== undefined && Object.hasOwn(registry, name)) return name;
  }
  return null;
}

function attr(props: Record<string, unknown>, name: string): string | undefined {
  const value = props[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The stand-in is styled inline rather than with classes: the renderer serves
 * every framework, and a `none/none` folder has no Tailwind to resolve a class
 * against. `currentColor` keeps it legible on both sides of the light/dark flip
 * without reading a token that a given theme may not define.
 *
 * It renders no children. The children were built for a parent that isn't there
 * any more, and a part that reads *this* component's context would throw in
 * turn — costing another pass to contain something the diagnosis has already
 * explained.
 */
function standIn(componentId: string, reason: string) {
  return function RenderErrorStandIn(props: Record<string, unknown>): ReactElement {
    return createElement(
      "div",
      {
        "data-velloo-render-error": componentId,
        // Selection still has to reach the node, or the one thing the box is
        // asking for — fix me, or delete me — can't be done from the canvas.
        "data-node-path": attr(props, "data-node-path"),
        "data-snippet-id": attr(props, "data-snippet-id"),
        "data-snippet-path": attr(props, "data-snippet-path"),
        title: reason,
        style: {
          border: "1px dashed currentColor",
          borderRadius: "6px",
          padding: "12px",
          opacity: 0.7,
          font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
          whiteSpace: "pre-wrap",
        },
      },
      `${componentId} failed to render — ${reason}`,
    );
  };
}

/**
 * Render through `toHtml`, replacing any component that throws with a stand-in
 * and trying again until the screen renders.
 *
 * `toHtml` takes the registry rather than closing over one so each attempt
 * rebuilds its tree against the substitutions made so far.
 *
 * Errors thrown before React runs — an unknown `$ref`, a snippet cycle, a
 * malformed node — name no component and pass straight through, so the route
 * keeps classifying them as it does today.
 */
export function renderGuarded(
  registry: ComponentRegistry,
  toHtml: (registry: ComponentRegistry) => string,
): GuardedRender {
  const failures: RenderFailure[] = [];
  let active = registry;
  for (;;) {
    try {
      return { html: toHtml(active), failures };
    } catch (error) {
      const componentId = blame(error, registry);
      // Give up on anything a stand-in can't address: an error naming no
      // component, one whose stand-in already failed to settle the render, or a
      // screen broken past the point of being worth another pass.
      if (componentId === null || failures.length >= MAX_STAND_INS) throw error;
      if (failures.some((failure) => failure.componentId === componentId)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ componentId, reason });
      active = { ...active, [componentId]: standIn(componentId, reason) };
    }
  }
}
