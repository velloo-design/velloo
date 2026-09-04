import { $, DoAsync, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";
import {
  applyStyleToProps,
  channelForScreen,
  type StylePayload,
  validateStylePayload,
} from "./style-channel.ts";

export interface UpdatePropsBulkArgs {
  screenId: string;
  patches: Array<{
    path: Locator;
    propPatch?: Record<string, unknown> | undefined;
    style?: StylePayload | undefined;
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
    const channel = channelForScreen(ctx, screen);
    // Validate every style payload before touching the tree, so a bad entry
    // halfway down the list cannot leave a partial write behind.
    for (const { style } of args.patches) {
      if (style !== undefined) yield* $(validateStylePayload(channel, style));
    }
    const next = cloneScreen(screen);

    const resolvedPaths: number[][] = [];
    for (const { path, propPatch, style } of args.patches) {
      const resolved = yield* $(resolve(next.tree, path, args.screenId));
      const node = yield* $(getComponentNode(next.tree, resolved, args.screenId));
      const merged: Record<string, unknown> = { ...(node.props ?? {}) };
      for (const [k, v] of Object.entries(propPatch ?? {})) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (style !== undefined) applyStyleToProps(channel, merged, style);
      if (Object.keys(merged).length === 0) delete node.props;
      else node.props = merged;
      resolvedPaths.push(resolved);
    }

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    broadcastTreeChange(ctx, args.screenId);
    return { paths: resolvedPaths };
  });
}
