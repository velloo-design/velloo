import type { Result } from "@velloo/result";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { type UpdatePropsResult, updateProps } from "./update-props.ts";

export interface ApplyClassesArgs {
  pageId: string;
  variantId: string;
  path: number[];
  /** Whitespace-separated Tailwind classes; replaces existing className. */
  classes: string;
}

export async function applyClasses(
  ctx: MutationContext,
  args: ApplyClassesArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  const className = args.classes.trim();
  return updateProps(ctx, {
    pageId: args.pageId,
    variantId: args.variantId,
    path: args.path,
    propPatch: { className: className === "" ? null : className },
  });
}
