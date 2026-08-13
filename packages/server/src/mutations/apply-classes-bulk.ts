import type { Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { type UpdatePropsBulkResult, updatePropsBulk } from "./update-props-bulk.ts";

export interface ApplyClassesBulkArgs {
  pageId: string;
  variantId: string;
  patches: Array<{
    /** Locator — path array or `"@id"` string. */
    path: Locator;
    /** Whitespace-separated Tailwind classes; replaces existing className. */
    classes: string;
  }>;
}

/**
 * Atomic bulk variant for `apply_classes`. Same one-persist / one-broadcast /
 * one-history semantics as updatePropsBulk — useful when restyling many
 * nodes together (e.g. dark-mode-aware refactor).
 */
export async function applyClassesBulk(
  ctx: MutationContext,
  args: ApplyClassesBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return updatePropsBulk(ctx, {
    pageId: args.pageId,
    variantId: args.variantId,
    patches: args.patches.map(({ path, classes }) => {
      const trimmed = classes.trim();
      return {
        path,
        propPatch: { className: trimmed === "" ? null : trimmed },
      };
    }),
  });
}
