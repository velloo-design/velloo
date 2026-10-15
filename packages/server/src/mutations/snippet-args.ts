import { $, DoAsync, type Result } from "@velloo/result";
import type { Screen, Snippet } from "@velloo/schema";
import { resolveComponentRefs } from "./component-refs.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { readNodeArgs } from "./node-args.ts";

/**
 * A snippet's args as every writer of them — and the preview — should take
 * them: `node` args read as nodes (`readNodeArgs`), and a component name
 * resolved the way one written anywhere else is, so the app's own component
 * by its bare name is that component rather than a name Velloo's library
 * doesn't have.
 */
export function checkSnippetArgs(
  ctx: MutationContext,
  snippet: Snippet,
  args: Record<string, unknown>,
  scope: Pick<Screen, "library"> | null,
): Promise<Result<Record<string, unknown>, MutationError>> {
  return DoAsync<Record<string, unknown>, MutationError>(async function* () {
    const read = yield* $(readNodeArgs(snippet, args));
    return yield* $(await resolveComponentRefs(ctx, read, scope));
  });
}
