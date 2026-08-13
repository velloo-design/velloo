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
import { isIdLocator, type Locator, pathAt, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  idNotFound,
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

/**
 * Resolve a locator → path against a variant root, returning a typed
 * error for the right failure mode:
 *  - `IdNotFound` when an `@id` locator doesn't match any node
 *  - `InvalidPath` when a number[] locator is out of range
 *
 * Callers need to pass pageId/variantId so the IdNotFound error carries
 * enough context for the agent to recover (which page/variant did the
 * lookup fail in?).
 */
export function resolve(
  root: Node,
  locator: Locator,
  pageId: string,
  variantId: string,
): Result<number[], MutationError> {
  const path = resolveLocator(root, locator);
  if (path !== null) return ok(path);
  if (isIdLocator(locator)) return err(idNotFound(pageId, variantId, locator.slice(1)));
  return err(invalidPath(`No node at path ${JSON.stringify(locator)}`, locator as number[]));
}

/**
 * Get the node at a locator. Mutation-friendly: returns an err Result with
 * the right kind for either an unknown @id or an out-of-range path.
 */
export function getNode(
  root: Node,
  locator: Locator,
  pageId: string,
  variantId: string,
): Result<Node, MutationError> {
  const r = resolve(root, locator, pageId, variantId);
  if (!r.ok) return r;
  const n = pathAt(root, r.value);
  return n ? ok(n) : err(invalidPath(`No node at path ${JSON.stringify(r.value)}`, r.value));
}

/**
 * Like getNode, but narrows to a `ComponentNode`. Used by mutations that
 * only make sense on a real component (add_node parent, update_props,
 * apply_classes, etc.). Snippet instances and param refs return
 * InvalidPath with a hint about which alternative tool to use.
 */
export function getComponentNode(
  root: Node,
  locator: Locator,
  pageId: string,
  variantId: string,
): Result<ComponentNode, MutationError> {
  const r = getNode(root, locator, pageId, variantId);
  if (!r.ok) return r;
  if (!isComponentNode(r.value)) {
    const r2 = resolve(root, locator, pageId, variantId);
    const path = r2.ok ? r2.value : [];
    return err(
      invalidPath(
        `Node at ${JSON.stringify(path)} is not a component (got ${describe(r.value)}). For snippet instances use update_snippet_args.`,
        path,
      ),
    );
  }
  return ok(r.value);
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
