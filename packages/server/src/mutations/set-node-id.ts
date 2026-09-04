import { $, DoAsync, type Result } from "@velloo/result";
import { isComponentNode, isSnippetInstance, NodeIdSchema } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { badRequest, invalidPath, type MutationError } from "./errors.ts";
import { getNode, getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface SetNodeIdArgs {
  screenId: string;
  path: Locator;
  /** Pass `null` to clear. Format: /^[a-zA-Z][a-zA-Z0-9_-]*$/. */
  id: string | null;
}

export interface SetNodeIdResult {
  path: number[];
  id: string | null;
}

export async function setNodeId(
  ctx: MutationContext,
  args: SetNodeIdArgs,
): Promise<Result<SetNodeIdResult, MutationError>> {
  if (args.id !== null) {
    const parsed = NodeIdSchema.safeParse(args.id);
    if (!parsed.success) {
      return {
        ok: false,
        error: badRequest(`Invalid node id ${JSON.stringify(args.id)}`, parsed.error.issues),
      };
    }
  }

  return DoAsync<SetNodeIdResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);

    const resolved = yield* $(resolve(next.tree, args.path, args.screenId));
    const node = yield* $(getNode(next.tree, resolved, args.screenId));

    if (!isComponentNode(node) && !isSnippetInstance(node)) {
      return yield* $({
        ok: false,
        error: invalidPath(
          `Node at ${JSON.stringify(resolved)} cannot carry an id (param refs are anonymous).`,
          resolved,
        ),
      } as Result<never, MutationError>);
    }

    if (args.id === null) {
      delete (node as { $id?: string | undefined }).$id;
    } else {
      (node as { $id?: string | undefined }).$id = args.id;
    }

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    broadcastTreeChange(ctx, args.screenId);
    return { path: resolved, id: args.id };
  });
}
