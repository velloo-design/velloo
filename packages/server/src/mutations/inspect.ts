import { renderBody, resolveSnippetBody } from "@velloo/renderer";
import { $, DoAsync, err, type Result } from "@velloo/result";
import {
  type ComponentNode,
  isComponentNode,
  isSnippetInstance,
  type Node,
  type Screen,
} from "@velloo/schema";
import type { Locator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetNotFound } from "./errors.ts";
import { resolveInnerNode } from "./inner-path.ts";
import { getNode, getScreen, registryForScreen } from "./lookup.ts";

export interface InspectArgs {
  screenId: string;
  path: Locator;
  /**
   * When `path` resolves to a snippet instance, addresses a node *inside*
   * the resolved body: a dotted index path like "0.2", an "@id" of a node
   * declared in the body, or "" for the body root (the default). Ignored
   * for plain component nodes.
   */
  innerPath?: string;
}

export interface InspectResult {
  ref: string;
  resolvedProps: Record<string, unknown>;
  classes: string[];
  /** SSR'd HTML for the subtree (no surrounding document). */
  bodyHtml: string;
  /** Present when the inspected node lives inside a snippet instance. */
  note?: string;
}

/**
 * SSR a single node in isolation by virtualizing it as a one-node screen.
 * The synthetic screen inherits `library` so the right provider registry
 * (and extensions) resolves.
 */
function renderIsolated(ctx: MutationContext, screen: Screen, node: Node): string {
  const subScreen: Screen = {
    id: `${screen.id}__inspect`,
    name: `${screen.name} inspect`,
    library: screen.library,
    tree: node,
  };
  return renderBody(subScreen, registryForScreen(ctx, subScreen), ctx.folder.snippets);
}

function inspectComponent(
  ctx: MutationContext,
  screen: Screen,
  node: ComponentNode,
  note?: string,
): InspectResult {
  const bodyHtml = renderIsolated(ctx, screen, node);
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
      return inspectComponent(ctx, screen, inner, note);
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

    return inspectComponent(ctx, screen, node, undefined);
  });
}
