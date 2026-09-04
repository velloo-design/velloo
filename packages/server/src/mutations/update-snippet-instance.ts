import type { UpdateSnippetInstancePlan } from "@velloo/protocol";
import { $, DoAsync, type Result } from "@velloo/result";
import { updateSnippetArgs } from "./api/snippets.ts";
import { overrideSnippetProps } from "./api/tree.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";

export interface UpdateSnippetInstanceResult {
  path: number[];
  /** Which sides of the instance this call actually touched. */
  applied: Array<"args" | "override">;
}

/**
 * Edit one snippet instance from either side in a single call. The two halves
 * are separate impls (one rewrites `args`/`$extraClassName`, the other merges
 * into `$overrides`), so this sequences them and reports which ran — the args
 * side first, since an override is read against the instance's resolved body.
 */
export async function updateSnippetInstance(
  ctx: MutationContext,
  plan: UpdateSnippetInstancePlan,
): Promise<Result<UpdateSnippetInstanceResult, MutationError>> {
  return DoAsync<UpdateSnippetInstanceResult, MutationError>(async function* () {
    const applied: Array<"args" | "override"> = [];
    let path: number[] | undefined;
    if (plan.args) {
      const r: { path: number[] } = yield* $(await updateSnippetArgs(ctx, plan.args));
      path = r.path;
      applied.push("args");
    }
    if (plan.override) {
      const r: { path: number[] } = yield* $(await overrideSnippetProps(ctx, plan.override));
      path = r.path;
      applied.push("override");
    }
    return { path: path ?? [], applied };
  });
}
