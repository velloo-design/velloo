import { type GuardedRender, renderBodyGuarded, resolveSnippetBody } from "@velloo/renderer";
import { $, DoAsync, err, type Result } from "@velloo/result";
import {
  type ComponentNode,
  isComponentNode,
  isSnippetInstance,
  type Node,
  type Screen,
} from "@velloo/schema";
import { createElement, type ReactElement, type ReactNode } from "react";
import { type Locator, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetNotFound } from "./errors.ts";
import { resolveInnerNode } from "./inner-path.ts";
import { getNode, getScreen, registryForScreen, resolve } from "./lookup.ts";

export interface InspectArgs {
  screenId: string;
  path: Locator;
  /**
   * When `path` resolves to a snippet instance, addresses a node *inside*
   * the resolved body: a dotted index path like "0.2", an "@id" of a node
   * declared in the body, or "" for the body root (the default). Ignored
   * for plain component nodes.
   */
  innerPath?: string | undefined;
}

export interface InspectResult {
  ref: string;
  resolvedProps: Record<string, unknown>;
  classes: string[];
  /** SSR'd HTML for the subtree (no surrounding document). */
  bodyHtml: string;
  /** Present when the inspected node lives inside a snippet instance. */
  note?: string | undefined;
}

/**
 * Wraps the inspected node so its own markup can be lifted back out of a
 * whole-tree render. A custom element renders as a bare tag, styles nothing,
 * and never nests — so one pair of indexOf calls finds it.
 */
const SUBJECT_REF = "__vellooInspectSubject";
const SUBJECT_TAG = "velloo-inspect-subject";

function Subject({ children }: { children?: ReactNode }): ReactElement {
  return createElement(SUBJECT_TAG, null, children);
}

function virtualScreen(screen: Screen, tree: Node): Screen {
  return {
    id: `${screen.id}__inspect`,
    name: `${screen.name} inspect`,
    library: screen.library,
    tree,
  };
}

/**
 * SSR a single node in isolation by virtualizing it as a one-node screen.
 * The synthetic screen inherits `library` so the right provider registry
 * (and extensions) resolves.
 */
function renderIsolated(ctx: MutationContext, screen: Screen, node: Node): GuardedRender {
  const subScreen = virtualScreen(screen, node);
  return renderBodyGuarded(subScreen, registryForScreen(ctx, subScreen), ctx.folder.snippets);
}

/** Replace the node at `path` with itself wrapped in the subject marker. */
function markSubject(root: Node, path: number[]): Node | null {
  if (path.length === 0) return { $ref: SUBJECT_REF, children: [root] };
  if (!isComponentNode(root)) return null;
  const [index, ...rest] = path;
  const children = root.children;
  if (index === undefined || !children) return null;
  const child = children[index];
  if (!child) return null;
  const marked = markSubject(child, rest);
  if (!marked) return null;
  const next = [...children];
  next[index] = marked;
  return { ...root, children: next };
}

function subjectMarkup(html: string): string | null {
  const open = `<${SUBJECT_TAG}>`;
  const start = html.indexOf(open);
  if (start === -1) return null;
  const end = html.indexOf(`</${SUBJECT_TAG}>`, start);
  return end === -1 ? null : html.slice(start + open.length, end);
}

/**
 * Render the node where it actually sits, and lift its own markup back out.
 *
 * Isolation is the cheaper and usually equivalent render, but it is a lie for
 * any node whose component reads a context an ancestor provides: a TabsTrigger
 * correctly nested in Tabs renders perfectly on the canvas and throws on its
 * own, so inspecting it in isolation would report a stand-in for healthy
 * markup. Rendering the whole tree keeps every provider *and* every sibling in
 * place, so what comes back is what the screen shows.
 */
function renderInPlace(
  ctx: MutationContext,
  screen: Screen,
  root: Node,
  path: number[],
): string | null {
  const marked = markSubject(root, path);
  if (!marked) return null;
  const subScreen = virtualScreen(screen, marked);
  const registry = { ...registryForScreen(ctx, subScreen), [SUBJECT_REF]: Subject };
  const { html } = renderBodyGuarded(subScreen, registry, ctx.folder.snippets);
  return subjectMarkup(html);
}

/** Where the node sits, for the in-place render to reach it. */
interface NodeSite {
  root: Node;
  path: number[];
}

function inspectComponent(
  ctx: MutationContext,
  screen: Screen,
  node: ComponentNode,
  site: NodeSite,
  note?: string,
): InspectResult {
  const isolated = renderIsolated(ctx, screen, node);
  // Only a node that failed alone is worth the whole-tree render; every other
  // node already has its own markup for the cost of one small SSR.
  const bodyHtml =
    isolated.failures.length > 0
      ? (renderInPlace(ctx, screen, site.root, site.path) ?? isolated.html)
      : isolated.html;
  const className = (node.props?.className ?? "") as string;
  const classes =
    typeof className === "string" ? className.trim().split(/\s+/).filter(Boolean) : [];
  return {
    ref: node.$ref,
    resolvedProps: { ...(node.props ?? {}) },
    classes,
    bodyHtml,
    ...(note ? { note } : {}),
  };
}

export async function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return DoAsync<InspectResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const node = yield* $(getNode(screen.tree, args.path, args.screenId));

    if (isSnippetInstance(node)) {
      const snippet = ctx.folder.snippets.get(node.$snippet);
      if (!snippet) return yield* $(err(snippetNotFound(node.$snippet)));

      const innerPath = args.innerPath ?? "";
      // Expand exactly as the renderer does so args, $overrides, and
      // $extraClassName are applied — you inspect what actually renders,
      // not the raw definition.
      const body = resolveSnippetBody(node, snippet);
      const inner = yield* $(resolveInnerNode(body, innerPath, node.$snippet));

      const note =
        innerPath === ""
          ? `Node is the body root of snippet instance "${node.$snippet}". Pass innerPath ("@id" or a dotted index like "0.2") to inspect a deeper node inside the body.`
          : `Node is inside snippet instance "${node.$snippet}" at innerPath "${innerPath}".`;
      // The resolved body is the node's world: a snippet carries its own
      // providers, and the instance's surroundings are not part of it.
      const innerSite = resolveLocator(body, innerPath === "" ? [] : innerPath) ?? [];
      return inspectComponent(ctx, screen, inner, { root: body, path: innerSite }, note);
    }

    if (args.innerPath !== undefined && args.innerPath !== "") {
      return yield* $(
        err(
          invalidPath(
            `innerPath "${args.innerPath}" was given but the node at ${JSON.stringify(args.path)} is not a snippet instance`,
          ),
        ),
      );
    }

    if (!isComponentNode(node)) {
      return yield* $(
        err(
          invalidPath(
            `Node at ${JSON.stringify(args.path)} is not inspectable (expected a component or snippet instance)`,
          ),
        ),
      );
    }

    const site = yield* $(resolve(screen.tree, args.path, args.screenId));
    return inspectComponent(ctx, screen, node, { root: screen.tree, path: site }, undefined);
  });
}
