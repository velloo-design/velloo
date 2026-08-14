import { err, ok, type Result } from "@velloo/result";
import {
  type Board,
  type ComponentNode,
  isComponentNode,
  type Node,
  type Screen,
  type Snippet,
} from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { isIdLocator, type Locator, pathAt, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  boardNotFound,
  idNotFound,
  invalidPath,
  type MutationError,
  nearestRefs,
  screenNotFound,
  snippetNotFound,
  unknownComponent,
} from "./errors.ts";

export function getScreen(ctx: MutationContext, screenId: string): Result<Screen, MutationError> {
  const s = ctx.folder.screens.get(screenId);
  return s ? ok(s) : err(screenNotFound(screenId));
}

export function getBoard(ctx: MutationContext, boardId: string): Result<Board, MutationError> {
  const b = ctx.folder.boards.get(boardId);
  return b ? ok(b) : err(boardNotFound(boardId));
}

/**
 * Resolve a locator → path against a screen tree, returning a typed
 * error for the right failure mode:
 *  - `IdNotFound` when an `@id` locator doesn't match any node
 *  - `InvalidPath` when a number[] locator is out of range
 */
export function resolve(
  root: Node,
  locator: Locator,
  screenId: string,
): Result<number[], MutationError> {
  const path = resolveLocator(root, locator);
  if (path !== null) return ok(path);
  if (isIdLocator(locator)) return err(idNotFound(screenId, locator.slice(1)));
  return err(invalidPath(`No node at path ${JSON.stringify(locator)}`, locator as number[]));
}

export function getNode(
  root: Node,
  locator: Locator,
  screenId: string,
): Result<Node, MutationError> {
  const r = resolve(root, locator, screenId);
  if (!r.ok) return r;
  const n = pathAt(root, r.value);
  return n ? ok(n) : err(invalidPath(`No node at path ${JSON.stringify(r.value)}`, r.value));
}

export function getComponentNode(
  root: Node,
  locator: Locator,
  screenId: string,
): Result<ComponentNode, MutationError> {
  const r = getNode(root, locator, screenId);
  if (!r.ok) return r;
  if (!isComponentNode(r.value)) {
    const r2 = resolve(root, locator, screenId);
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
