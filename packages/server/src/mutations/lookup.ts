import { err, ok, type Result } from "@velloo/result";
import {
  type ComponentNode,
  isComponentNode,
  type Node,
  type Page,
  type Snippet,
  type Variant,
} from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { pathAt } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  invalidPath,
  type MutationError,
  nearestRefs,
  pageNotFound,
  snippetNotFound,
  unknownComponent,
  variantNotFound,
} from "./errors.ts";

export function getPage(ctx: MutationContext, pageId: string): Result<Page, MutationError> {
  const page = ctx.folder.pages.get(pageId);
  return page ? ok(page) : err(pageNotFound(pageId));
}

export function getVariant(
  page: Page,
  pageId: string,
  variantId: string,
): Result<Variant, MutationError> {
  const v = page.variants.find((x) => x.id === variantId);
  return v ? ok(v) : err(variantNotFound(pageId, variantId));
}

export function getNode(root: Node, path: number[]): Result<Node, MutationError> {
  const n = pathAt(root, path);
  return n ? ok(n) : err(invalidPath(`No node at path ${JSON.stringify(path)}`, path));
}

/**
 * Like getNode, but narrows to a `ComponentNode`. Used by mutations that
 * only make sense on a real component (add_node parent, update_props,
 * apply_classes, etc.). Snippet instances and param refs return
 * InvalidPath with a hint about which alternative tool to use.
 */
export function getComponentNode(root: Node, path: number[]): Result<ComponentNode, MutationError> {
  const found = pathAt(root, path);
  if (!found) return err(invalidPath(`No node at path ${JSON.stringify(path)}`, path));
  if (!isComponentNode(found)) {
    return err(
      invalidPath(
        `Node at ${JSON.stringify(path)} is not a component (got ${describe(found)}). For snippet instances use update_snippet_args.`,
        path,
      ),
    );
  }
  return ok(found);
}

function describe(node: Node): string {
  if (isComponentNode(node)) return `$ref=${node.$ref}`;
  if ("$snippet" in node) return `$snippet=${node.$snippet}`;
  return `$param=${(node as { $param: string }).$param}`;
}

export function ensureKnownComponent(ref: string): Result<void, MutationError> {
  if (isKnownComponent(ref)) return ok(undefined);
  return err(unknownComponent(ref, nearestRefs(ref, Object.keys(registry))));
}

export function getSnippet(
  ctx: MutationContext,
  snippetId: string,
): Result<Snippet, MutationError> {
  const s = ctx.folder.snippets?.get(snippetId);
  return s ? ok(s) : err(snippetNotFound(snippetId));
}
