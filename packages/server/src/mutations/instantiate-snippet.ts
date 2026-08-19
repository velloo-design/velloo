import { $, DoAsync, err, type Result } from "@velloo/result";
import { type Node, resolveSnippetArgs, type Snippet, type SnippetInstance } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { invalidPath, type MutationError, snippetParamMismatch } from "./errors.ts";
import { getComponentNode, getScreen, getSnippet, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface InstantiateSnippetArgs {
  screenId: string;
  parentPath: Locator;
  snippetId: string;
  id?: string;
  args?: Record<string, unknown>;
  extraClassName?: string;
  index?: number;
}

export interface InstantiateSnippetResult {
  path: number[];
}

export async function instantiateSnippet(
  ctx: MutationContext,
  args: InstantiateSnippetArgs,
): Promise<Result<InstantiateSnippetResult, MutationError>> {
  return DoAsync<InstantiateSnippetResult, MutationError>(async function* () {
    const snippet = yield* $(getSnippet(ctx, args.snippetId));
    yield* $(validateArgs(snippet, args.args ?? {}));

    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);

    const resolvedParent = yield* $(resolve(next.tree, args.parentPath, args.screenId));
    const parent = yield* $(getComponentNode(next.tree, resolvedParent, args.screenId));
    if (!parent.children) parent.children = [];
    const idx = args.index ?? parent.children.length;
    if (idx < 0 || idx > parent.children.length) {
      return yield* $(
        err(
          invalidPath(
            `index ${idx} out of range for parent with ${parent.children.length} children`,
            resolvedParent,
          ),
        ),
      );
    }

    const node: SnippetInstance = {
      $snippet: snippet.id,
      ...(args.id !== undefined ? { $id: args.id } : {}),
      ...(args.extraClassName && args.extraClassName.trim() !== ""
        ? { $extraClassName: args.extraClassName.trim() }
        : {}),
      ...(args.args && Object.keys(args.args).length > 0 ? { args: args.args } : {}),
    };
    parent.children.splice(idx, 0, node as Node);

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    broadcastTreeChange(ctx, args.screenId);
    return { path: [...resolvedParent, idx] };
  });
}

function validateArgs(
  snippet: Snippet,
  passed: Record<string, unknown>,
): Result<void, MutationError> {
  const declared = new Set(snippet.params.map((p) => p.name));
  // Reuse the renderer's canonical resolution so `optional` + `default`
  // semantics match the `add_node` `$snippet` path exactly — one source of
  // truth, instead of a second loop that drifts (it used to ignore `optional`).
  const { missing } = resolveSnippetArgs(snippet, passed);
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
