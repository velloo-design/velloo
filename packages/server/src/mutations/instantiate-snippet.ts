import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Node, Snippet, SnippetInstance } from "@velloo/schema";
import { clonePage } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetParamMismatch } from "./errors.ts";
import { getComponentNode, getPage, getSnippet, getVariant } from "./lookup.ts";
import { persistPage } from "./persist.ts";

export interface InstantiateSnippetArgs {
  pageId: string;
  variantId: string;
  parentPath: number[];
  snippetId: string;
  args?: Record<string, unknown>;
  index?: number;
}

export interface InstantiateSnippetResult {
  /** Path of the newly inserted snippet instance. */
  path: number[];
}

/**
 * Insert a `$snippet` node into a variant tree. Validates args against the
 * snippet's declared params (missing required → SnippetParamMismatch).
 */
export async function instantiateSnippet(
  ctx: MutationContext,
  args: InstantiateSnippetArgs,
): Promise<Result<InstantiateSnippetResult, MutationError>> {
  return DoAsync<InstantiateSnippetResult, MutationError>(async function* () {
    const snippet = yield* $(getSnippet(ctx, args.snippetId));
    yield* $(validateArgs(snippet, args.args ?? {}));

    const page = yield* $(getPage(ctx, args.pageId));
    yield* $(getVariant(page, args.pageId, args.variantId));

    const next = clonePage(page);
    const nextVariant = next.variants.find((v) => v.id === args.variantId);
    if (!nextVariant) throw new Error("invariant: variant lost on clone");

    const parent = yield* $(getComponentNode(nextVariant.tree, args.parentPath));
    if (!parent.children) parent.children = [];
    const idx = args.index ?? parent.children.length;
    if (idx < 0 || idx > parent.children.length) {
      return yield* $(
        err(
          invalidPath(
            `index ${idx} out of range for parent with ${parent.children.length} children`,
            args.parentPath,
          ),
        ),
      );
    }

    const node: SnippetInstance = {
      $snippet: snippet.id,
      ...(args.args && Object.keys(args.args).length > 0 ? { args: args.args } : {}),
    };
    parent.children.splice(idx, 0, node as Node);

    await persistPage(ctx.folder, args.pageId, next);
    ctx.broadcast({ type: "page-changed", pageId: args.pageId });
    return { path: [...args.parentPath, idx] };
  });
}

/**
 * Verify every required (no-default) param has a corresponding arg. Loose on
 * types — the agent might legitimately pass a Node into a string slot
 * via a $param indirection downstream. Strict type checking on the leaf
 * values is the snippet body's responsibility at render time.
 */
function validateArgs(
  snippet: Snippet,
  passed: Record<string, unknown>,
): Result<void, MutationError> {
  const declared = new Set(snippet.params.map((p) => p.name));
  const missing: string[] = [];
  for (const p of snippet.params) {
    if (!(p.name in passed) && p.default === undefined) missing.push(p.name);
  }
  const extras = Object.keys(passed).filter((k) => !declared.has(k));
  if (missing.length === 0 && extras.length === 0) return { ok: true, value: undefined };
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing required: ${missing.join(", ")}`);
  if (extras.length > 0) parts.push(`unknown: ${extras.join(", ")}`);
  return {
    ok: false,
    error: snippetParamMismatch(snippet.id, parts.join("; "), { missing, extras }),
  };
}
