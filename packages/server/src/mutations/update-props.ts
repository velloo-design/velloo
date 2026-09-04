import { $, DoAsync, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getScreen, resolveWithSnippetHint } from "./lookup.ts";
import { commitScreen } from "./persist.ts";
import {
  applyStyleToProps,
  channelForScreen,
  type StylePayload,
  validateStylePayload,
} from "./style-channel.ts";

export interface UpdatePropsArgs {
  screenId: string;
  path: Locator;
  /** Shallow patch. Keys with `null` values are removed. */
  propPatch?: Record<string, unknown> | undefined;
  /**
   * Style through the screen's *native* channel — the framework adapter routes
   * it to `className` (Tailwind), `sx` (MUI), or `style`. Applied after
   * `propPatch`, so the two can travel in one call.
   */
  style?: StylePayload | undefined;
}

export interface UpdatePropsResult {
  path: number[];
}

export async function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  const { screenId, path, propPatch, style } = args;
  return DoAsync<UpdatePropsResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, screenId));
    const channel = channelForScreen(ctx, screen);
    if (style !== undefined) yield* $(validateStylePayload(channel, style));

    const next = cloneScreen(screen);
    const resolved = yield* $(resolveWithSnippetHint(ctx, next.tree, path, screenId));
    const node = yield* $(getComponentNode(next.tree, resolved, screenId));

    const merged: Record<string, unknown> = { ...(node.props ?? {}) };
    for (const [k, v] of Object.entries(propPatch ?? {})) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (style !== undefined) applyStyleToProps(channel, merged, style);
    if (Object.keys(merged).length === 0) delete node.props;
    else node.props = merged;

    yield* $(await commitScreen(ctx.folder, screenId, next));
    broadcastTreeChange(ctx, screenId);
    return { path: resolved };
  });
}
