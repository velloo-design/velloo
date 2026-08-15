import { $, DoAsync, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface UpdatePropsBulkArgs {
  screenId: string;
  patches: Array<{
    path: Locator;
    propPatch: Record<string, unknown>;
  }>;
}

export interface UpdatePropsBulkResult {
  paths: number[][];
}

export async function updatePropsBulk(
  ctx: MutationContext,
  args: UpdatePropsBulkArgs,
): Promise<Result<UpdatePropsBulkResult, MutationError>> {
  return DoAsync<UpdatePropsBulkResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);

    const resolvedPaths: number[][] = [];
    for (const { path, propPatch } of args.patches) {
      const resolved = yield* $(resolve(next.tree, path, args.screenId));
      const node = yield* $(getComponentNode(next.tree, resolved, args.screenId));
      const merged: Record<string, unknown> = { ...(node.props ?? {}) };
      for (const [k, v] of Object.entries(propPatch)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length === 0) delete node.props;
      else node.props = merged;
      resolvedPaths.push(resolved);
    }

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    broadcastTreeChange(ctx, args.screenId);
    return { paths: resolvedPaths };
  });
}
