/**
 * Containment for a node that cannot render — one that throws, or one whose
 * `$ref` names a component that isn't there.
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
import { createElement, type ReactElement, type ReactNode } from "react";
import { UnknownComponentError } from "./build-tree.ts";

/** A component that could not render, and was replaced by a stand-in. */
export interface RenderFailure {
  /** Registry id of the component that failed. */
  componentId: string;
  /** The underlying message, shown in the stand-in and carried to the caller. */
  reason: string;
  /**
   * Whether the component threw or was never in the registry. The two read the
   * same on screen but not to a caller: a throw is a bug in a component that
   * exists, a miss is a `$ref` naming one that doesn't.
   */
  kind: "threw" | "missing";
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
 * The guard stood in for as many components as it will and the screen still
 * threw. Rethrowing the last component's own error would read as though that
 * one component were the whole story, so this names the cap and carries every
 * failure it saw — the stand-ins it made and the one that tipped it over.
 */
export class RenderGuardLimitError extends Error {
  readonly failures: RenderFailure[];
  constructor(failures: RenderFailure[], options?: ErrorOptions) {
    super(
      `${failures.length} components failed to render — more than the ${MAX_STAND_INS} the guard will stand in for, so the screen was not drawn.`,
      options,
    );
    this.name = "RenderGuardLimitError";
    this.failures = failures;
  }
}

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
 * Whether it keeps the node's children turns on why it is here. A component
 * that threw has children built for a parent that isn't there any more, and a
 * part reading *its* context would throw in turn — another pass to contain
 * something the diagnosis has already explained. A `$ref` that names nothing
 * has no such context to miss: its children are ordinary nodes that render
 * fine, and dropping them would hide real content and leave every row beneath
 * it in the tree pointing at no element to select.
 */
function standIn(componentId: string, reason: string, kind: RenderFailure["kind"]) {
  const missing = kind === "missing";
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
          // Dimming the box would dim the children with it, and those are the
          // one part of a missing component that is not broken.
          ...(missing ? {} : { opacity: 0.7 }),
          font: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
          whiteSpace: "pre-wrap",
        },
      },
      createElement(
        "span",
        { style: { display: "block", opacity: 0.7 } },
        missing
          ? `${componentId} is not in this screen's library`
          : `${componentId} failed to render — ${reason}`,
      ),
      missing ? (props.children as ReactNode) : null,
    );
  };
}

/**
 * Render through `toHtml`, replacing any component that throws with a stand-in
 * and trying again until the screen renders.
 *
 * `toHtml` takes the registry rather than closing over one so each attempt
 * rebuilds its tree against the substitutions made so far. A `$ref` that names
 * nothing is contained the same way, and falls out of the same mechanism: the
 * substitution *is* the missing registry entry, so the next pass finds it.
 *
 * What still passes straight through is everything that names no component at
 * all — a snippet cycle, a malformed node, a `$param` outside a snippet body.
 * Those have no single node to stand in for, so the route classifies them.
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
      const unknown = error instanceof UnknownComponentError;
      // A missing component names itself; a thrown one has to be read off the
      // stack, and is by definition already in the registry.
      const componentId = unknown ? error.ref : blame(error, registry);
      // Give up on anything a stand-in can't address: an error naming no
      // component, one whose stand-in already failed to settle the render, or a
      // screen broken past the point of being worth another pass.
      if (componentId === null) throw error;
      if (failures.some((failure) => failure.componentId === componentId)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      const kind = unknown ? "missing" : "threw";
      if (failures.length >= MAX_STAND_INS) {
        throw new RenderGuardLimitError([...failures, { componentId, reason, kind }], {
          cause: error,
        });
      }
      failures.push({ componentId, reason, kind });
      active = { ...active, [componentId]: standIn(componentId, reason, kind) };
    }
  }
}
