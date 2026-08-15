import type { ComponentProvider, ComponentRegistry } from "@velloo/provider";
import { err, ok, type Result } from "@velloo/result";
import {
  type Board,
  type ComponentNode,
  type Extension,
  isComponentNode,
  type Node,
  type Screen,
  type Snippet,
} from "@velloo/schema";
import {
  providerForScreen as providerForScreenImpl,
  registryForScreen as registryForScreenImpl,
} from "../extensions/registry.ts";
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

/**
 * Sentinel screenId prefix that virtualizes a snippet body as a screen so
 * the existing tree mutations work against it. The canvas's snippet
 * editor sets `selection.screenId = "snippet:<id>"`; everything
 * downstream (resolve, clone, persist) flows through this adapter. See
 * `decisions.md` note on snippet body editing.
 */
export const SNIPPET_TREE_PREFIX = "snippet:";

export function isSnippetTreeId(screenId: string): boolean {
  return screenId.startsWith(SNIPPET_TREE_PREFIX);
}

export function snippetIdFromTreeId(screenId: string): string {
  return screenId.slice(SNIPPET_TREE_PREFIX.length);
}

export function getScreen(ctx: MutationContext, screenId: string): Result<Screen, MutationError> {
  if (isSnippetTreeId(screenId)) {
    const snippetId = snippetIdFromTreeId(screenId);
    const snippet = ctx.folder.snippets.get(snippetId);
    if (!snippet) return err(snippetNotFound(snippetId));
    // Synthesize a screen so downstream impls don't need to branch.
    // Persistence routes back to the snippet via `commitScreen`'s detection.
    return ok({ id: screenId, name: snippet.name, tree: snippet.tree });
  }
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

/**
 * Folder-wide extension registry. Read straight from
 * `folder.config.extensions` so the lookup is always against the most
 * recent state (after an `add_extension` mutation that updates the
 * config in place).
 */
export function getExtensions(ctx: MutationContext): Record<string, Extension> {
  return ctx.folder.config.extensions ?? {};
}

/**
 * Pick the provider a given screen's tree resolves against. Sprint Y:
 * a screen's `library` field selects from `ctx.providers`; absent
 * means use the default. Snippet bodies inherit their snippet's
 * library (not the embedding screen's) — see `decisions.md` #24.
 */
export function providerForScreen(
  ctx: MutationContext,
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
): ComponentProvider {
  return providerForScreenImpl(screen, ctx.providers, ctx.defaultProvider);
}

/**
 * Build the registry the renderer reads for a single screen: the
 * screen's provider's runtime registry, with the folder's extension
 * placeholders merged in. Extensions shadow library components of the
 * same name.
 */
export function registryForScreen(
  ctx: MutationContext,
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
): ComponentRegistry {
  return registryForScreenImpl(screen, ctx.providers, ctx.defaultProvider, getExtensions(ctx));
}

/**
 * Validate that a `$ref` resolves to either a library component or a
 * registered extension. Sprint Y: takes the screen so it can pick the
 * right library (extensions are folder-global, libraries are
 * per-screen). The screen lookup is permissive — pass `null` when
 * checking against the default library (e.g. before a screen exists).
 */
export function ensureKnownComponent(
  ctx: MutationContext,
  ref: string,
  screen: Pick<Screen, "library"> | null = null,
): Result<void, MutationError> {
  const provider = screen ? providerForScreen(ctx, screen) : ctx.defaultProvider;
  if (ref in provider.registry) return ok(undefined);
  const extensions = getExtensions(ctx);
  if (ref in extensions) return ok(undefined);
  const known = [...Object.keys(provider.registry), ...Object.keys(extensions)];
  return err(unknownComponent(ref, nearestRefs(ref, known)));
}

export function getSnippet(
  ctx: MutationContext,
  snippetId: string,
): Result<Snippet, MutationError> {
  const s = ctx.folder.snippets?.get(snippetId);
  return s ? ok(s) : err(snippetNotFound(snippetId));
}
