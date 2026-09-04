import type { ComponentProvider, ComponentRegistry, RenderPass } from "@velloo/provider";
import { err, ok, type Result } from "@velloo/result";
import {
  type Board,
  type ComponentNode,
  type Extension,
  isComponentNode,
  isSnippetInstance,
  type Node,
  type Screen,
  type Snippet,
  type Theme,
} from "@velloo/schema";
import {
  providerForScreen as providerForScreenImpl,
  registryForScreen as registryForScreenImpl,
  renderPassForScreen as renderPassForScreenImpl,
} from "../extensions/registry.ts";
import { isIdLocator, type Locator, pathAt, resolveLocator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  boardNotFound,
  idNotFound,
  invalidPath,
  type MutationError,
  nearestRefs,
  normalizeRef,
  screenNotFound,
  snippetNotFound,
  unknownComponent,
} from "./errors.ts";

/**
 * Sentinel screenId prefix that virtualizes a snippet body as a screen so
 * the existing tree mutations work against it. The canvas's snippet
 * editor sets `selection.screenId = "snippet:<id>"`; everything
 * downstream (resolve, clone, persist) flows through this adapter.
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
  if (isIdLocator(locator)) {
    const id = locator.slice(1);
    const hint =
      id === "root"
        ? `There is no node with id "root". The root node is the empty path []; tools like screenshot/compare_to_url treat the whole screen as the default when \`path\` is omitted.`
        : undefined;
    return err(idNotFound(screenId, id, hint));
  }
  return err(
    invalidPath(
      `No node at path ${JSON.stringify(locator)}`,
      locator as number[],
      `Numeric paths go stale after siblings are added, removed, or moved. Re-locate the node with find_nodes (it returns current paths + ids), or give it a stable @id via set_node_id and address it as "@id".`,
    ),
  );
}

/** True if any component node inside `node`'s subtree carries `$id === id`. */
function subtreeHasId(node: Node, id: string): boolean {
  if (!isComponentNode(node)) return false;
  if (node.$id === id) return true;
  return (node.children ?? []).some((c) => subtreeHasId(c, id));
}

/**
 * Scan a screen tree for a snippet instance whose *definition* declares a
 * node with `$id === id`. Snippet instances are opaque to `@id` resolution
 * (see `path.ts` findById) — an id that lives inside a shared body never
 * resolves at the top level — so this lets a failed lookup point the agent
 * at the right tool. Returns the addressable instance locator + snippet id.
 */
function findInstanceExposingId(
  ctx: MutationContext,
  root: Node,
  id: string,
): { instanceLocator: string; snippetId: string } | null {
  let hit: { instanceLocator: string; snippetId: string } | null = null;
  function walk(node: Node, path: number[]): void {
    if (hit) return;
    if (isSnippetInstance(node)) {
      const def = ctx.folder.snippets.get(node.$snippet);
      if (def && subtreeHasId(def.tree, id)) {
        hit = {
          instanceLocator: node.$id ? `@${node.$id}` : JSON.stringify(path),
          snippetId: node.$snippet,
        };
      }
      return; // opaque — never descend into a body
    }
    if (!isComponentNode(node)) return;
    const kids = node.children ?? [];
    for (let i = 0; i < kids.length && !hit; i++) {
      const child = kids[i];
      if (child) walk(child, [...path, i]);
    }
  }
  walk(root, []);
  return hit;
}

/**
 * Like `resolve`, but when an `@id` misses, check whether the id names a
 * node *inside* a snippet instance's body and, if so, attach a hint to the
 * `IdNotFound` pointing at `override_snippet_props` (per-instance) and
 * `update_snippet` (all instances). Use this from prop-editing mutations so
 * "edit one row inside a shared instance" is discoverable instead of dead-ending.
 */
export function resolveWithSnippetHint(
  ctx: MutationContext,
  root: Node,
  locator: Locator,
  screenId: string,
): Result<number[], MutationError> {
  const r = resolve(root, locator, screenId);
  if (r.ok || r.error.kind !== "IdNotFound") return r;
  const found = findInstanceExposingId(ctx, root, r.error.id);
  if (!found) return r;
  const hint =
    `"${r.error.id}" isn't a top-level node, but a node with that id lives inside snippet instance ` +
    `${found.instanceLocator} (snippet "${found.snippetId}"), which is opaque to @id addressing. ` +
    `To change its props for just this instance: override_snippet_props { path: "${found.instanceLocator}", ` +
    `innerPath: "@${r.error.id}", propPatch: {…} }. To change it across all instances, edit the snippet ` +
    `body with update_snippet.`;
  return err(idNotFound(screenId, r.error.id, hint));
}

export function getNode(
  root: Node,
  locator: Locator,
  screenId: string,
): Result<Node, MutationError> {
  const r = resolve(root, locator, screenId);
  if (!r.ok) return r;
  const n = pathAt(root, r.value);
  return n
    ? ok(n)
    : err(
        invalidPath(
          `No node at path ${JSON.stringify(r.value)}`,
          r.value,
          `Numeric paths go stale after siblings change. Re-locate with find_nodes or address by stable @id.`,
        ),
      );
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
        `Node at ${JSON.stringify(path)} is not a component (got ${describe(r.value)}). For snippet instances use update_snippet_instance.`,
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
 * Pick the provider a given screen's tree resolves against:
 * a screen's `library` field selects from `ctx.providers`; absent
 * means use the default. Snippet bodies inherit their snippet's
 * library (not the embedding screen's).
 */
/**
 * The library id a screen resolves to — its own `library` when registered,
 * else the folder default. The id (not just the provider instance) matters
 * to per-library caches like the canvas bundler.
 */
export function libraryIdForScreen(
  ctx: Pick<MutationContext, "folder">,
  screen: Pick<Screen, "library">,
): string {
  const id = screen.library;
  if (id && ctx.folder.config.libraries?.[id]) return id;
  return ctx.folder.config.defaultLibrary;
}

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
  return registryForScreenImpl(
    screen,
    ctx.providers,
    ctx.defaultProvider,
    getExtensions(ctx),
    ctx.folder.config.styling?.framework,
  );
}

/**
 * The screen's framework adapter render pass (MUI/emotion) bound to a theme, or
 * undefined for Tailwind-class frameworks. Pass into `renderScreen` so a MUI
 * screen's emotion CSS is captured into the document.
 */
export function renderPassForScreen(
  ctx: MutationContext,
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  theme: Theme,
  dark = false,
): RenderPass | undefined {
  return renderPassForScreenImpl(screen, ctx.providers, ctx.defaultProvider, theme, dark);
}

/**
 * Validate that a `$ref` resolves to either a library component or a
 * registered extension. Takes the screen so it can pick the
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
  // Common mix-up: a `$ref` that's actually a snippet — PascalCase "SiteHeader" for the
  // kebab snippet "site-header". Snippets aren't components; point at the right tool.
  const snippetMatch = [...ctx.folder.snippets.keys()].find(
    (s) => normalizeRef(s) === normalizeRef(ref),
  );
  if (snippetMatch) {
    return err(
      unknownComponent(
        ref,
        [],
        `"${ref}" is a snippet, not a library component. Place it with instantiate_snippet, or use a {"$snippet":"${snippetMatch}"} node — "$ref" is only for library components and registered extensions.`,
      ),
    );
  }
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
