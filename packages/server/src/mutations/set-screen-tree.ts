import { $, DoAsync, type Result } from "@velloo/result";
import type { Node } from "@velloo/schema";
import { cloneNode, cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface SetScreenTreeArgs {
  screenId: string;
  tree: Node;
}

export interface SetScreenTreeResult {
  screenId: string;
  /** Ref of the tree that was replaced, for the agent's sanity check. */
  replacedRootRef: string;
}

/**
 * Replace a screen's ENTIRE tree in one call. The affordance agents reach for
 * when rebuilding a route-scan placeholder — previously done by looping
 * remove_node over shifting indices (the single largest error class in the
 * trace corpus). Routing through commitScreen keeps schema validation, `$id`
 * uniqueness, undo history, and broadcast identical to every other mutation.
 */
export async function setScreenTree(
  ctx: MutationContext,
  args: SetScreenTreeArgs,
): Promise<Result<SetScreenTreeResult, MutationError>> {
  const { screenId } = args;
  return DoAsync<SetScreenTreeResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, screenId));
    const prevRef = "$ref" in screen.tree ? (screen.tree.$ref as string) : "(root)";
    const next = cloneScreen(screen);
    next.tree = cloneNode(args.tree);
    yield* $(await commitScreen(ctx.folder, screenId, next));
    broadcastTreeChange(ctx, screenId);
    return { screenId, replacedRootRef: prevRef };
  });
}
