import type { Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { type UpdatePropsBulkResult, updatePropsBulk } from "./update-props-bulk.ts";

export interface ApplyClassesBulkArgs {
  screenId: string;
  patches: Array<{
    path: Locator;
    classes: string;
  }>;
}

export async function applyClassesBulk(
  ctx: MutationContext,
  args: ApplyClassesBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return updatePropsBulk(ctx, {
    screenId: args.screenId,
    patches: args.patches.map(({ path, classes }) => {
      const trimmed = classes.trim();
      return {
        path,
        propPatch: { className: trimmed === "" ? null : trimmed },
      };
    }),
  });
}
