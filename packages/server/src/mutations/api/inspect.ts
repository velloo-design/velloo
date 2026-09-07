import type { Result } from "@velloo/result";
import type { MutationContext } from "../context.ts";
import type { MutationError } from "../errors.ts";
import { type InspectArgs, type InspectResult, inspect as inspectImpl } from "../inspect.ts";

export function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return inspectImpl(ctx, args);
}

export type { InspectArgs, InspectResult };
