import { $, DoAsync, err, type Result } from "@velloo/result";
import { isSnippetInstance, type SnippetInstance } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { pathAt } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetNotFound } from "./errors.ts";
import { innerPathResolves } from "./inner-path.ts";
import { getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

/**
 * Per-instance interior override: patch the props of one node *inside*
 * a snippet instance's resolved body without forking the snippet. The
 * patch persists on the instance as `$overrides[innerPath]` and is
 * applied after param substitution at render time. emit_code inlines
 * overridden instances (a shared component can't express them).
 */
export interface OverrideSnippetPropsArgs {
  screenId: string;
  /** Locator of the snippet instance node in the screen tree. */
  path: Locator;
  /** Dotted path or "@id" into the resolved body; "" targets the body root. */
  innerPath: string;
  /** Shallow merge into the body node's props; null removes a key. */
  propPatch: Record<string, unknown>;
}

export interface OverrideSnippetPropsResult {
  path: number[];
  innerPath: string;
  /** The instance's full override map after the patch. */
  overrides: Record<string, { props: Record<string, unknown> }>;
}

export async function overrideSnippetProps(
  ctx: MutationContext,
  args: OverrideSnippetPropsArgs,
): Promise<Result<OverrideSnippetPropsResult, MutationError>> {
  return DoAsync<OverrideSnippetPropsResult, MutationError>(async function* () {
    if (!/^$|^\d+(\.\d+)*$|^@[a-zA-Z][a-zA-Z0-9_-]*$/.test(args.innerPath)) {
      return yield* $(
        err(
          invalidPath(
            `innerPath must be a dotted index path like "0.2", an "@id" of a node inside the body, or "" for the root`,
          ),
        ),
      );
    }
    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);
    const resolved = yield* $(resolve(next.tree, args.path, args.screenId));
    const node = pathAt(next.tree, resolved);
    if (!node || !isSnippetInstance(node)) {
      return yield* $(
        err(invalidPath(`Node at ${JSON.stringify(resolved)} is not a snippet instance`, resolved)),
      );
    }
    const instance: SnippetInstance = node;
    const snippet = ctx.folder.snippets.get(instance.$snippet);
    if (!snippet) return yield* $(err(snippetNotFound(instance.$snippet)));

    // Validate against the definition tree — structurally identical to
    // the resolved body (substitution is value-level, not shape-level).
    if (!innerPathResolves(snippet.tree, args.innerPath)) {
      return yield* $(
        err(
          invalidPath(
            `innerPath "${args.innerPath}" doesn't resolve to a component inside snippet "${instance.$snippet}"`,
          ),
        ),
      );
    }

    const overrides = { ...(instance.$overrides ?? {}) };
    const merged = { ...(overrides[args.innerPath]?.props ?? {}) };
    for (const [k, v] of Object.entries(args.propPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length === 0) delete overrides[args.innerPath];
    else overrides[args.innerPath] = { props: merged };

    if (Object.keys(overrides).length === 0) delete instance.$overrides;
    else instance.$overrides = overrides;

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    broadcastTreeChange(ctx, args.screenId);
    return { path: resolved, innerPath: args.innerPath, overrides };
  });
}
