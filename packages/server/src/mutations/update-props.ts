import type { UpdatePropsArgs } from "@velloo/protocol";
import type { StyleChannel } from "@velloo/provider";
import { $, DoAsync, ok, type Result } from "@velloo/result";
import { type ComponentNode, repoKey } from "@velloo/schema";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getScreen, resolveWithSnippetHint } from "./lookup.ts";
import { commitScreen } from "./persist.ts";
import {
  applyStyleToProps,
  channelForScreen,
  repoStyleChannel,
  type StylePayload,
  validateStylePayload,
} from "./style-channel.ts";

export type { UpdatePropsArgs };

export interface UpdatePropsResult {
  /** Resolved path per entry, in the order they were given. */
  paths: number[][];
}

/**
 * Patch props and/or native styling on one or more nodes in a single write.
 *
 * Entries apply in order against one cloned screen, so a call touching twenty
 * nodes costs one lock, one commit and one broadcast. Style payloads are all
 * validated up front: a bad entry halfway down the list must not leave the
 * earlier ones written.
 */
export async function updateProps(
  ctx: MutationContext,
  args: UpdatePropsArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  return DoAsync<UpdatePropsResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const screenChannel = channelForScreen(ctx, screen);
    const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
    // A repository component styles through the props it declares, not the
    // screen's channel: Mantine's Button takes `style`, not a Tailwind string.
    const channelFor = (
      node: ComponentNode,
      style: StylePayload,
    ): Result<StyleChannel, MutationError> =>
      node.$repo
        ? repoStyleChannel(catalog?.byKey.get(repoKey(node.$repo))?.styleProps, style, node.$ref)
        : ok(screenChannel);
    for (const { path, style } of args.patches) {
      if (style === undefined) continue;
      const located = resolveWithSnippetHint(ctx, screen.tree, path, args.screenId);
      const target = located.ok
        ? getComponentNode(screen.tree, located.value, args.screenId)
        : null;
      const channel = target?.ok ? yield* $(channelFor(target.value, style)) : screenChannel;
      yield* $(validateStylePayload(channel, style));
    }

    const next = cloneScreen(screen);
    const paths: number[][] = [];
    for (const { path, propPatch, style } of args.patches) {
      const resolved = yield* $(resolveWithSnippetHint(ctx, next.tree, path, args.screenId));
      const node = yield* $(getComponentNode(next.tree, resolved, args.screenId));
      const channel = style === undefined ? screenChannel : yield* $(channelFor(node, style));
      const merged: Record<string, unknown> = { ...(node.props ?? {}) };
      for (const [k, v] of Object.entries(propPatch ?? {})) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (style !== undefined) applyStyleToProps(channel, merged, style);
      if (Object.keys(merged).length === 0) delete node.props;
      else node.props = merged;
      paths.push(resolved);
    }

    yield* $(await commitScreen(ctx.folder, args.screenId, next, args.gesture));
    broadcastTreeChange(ctx, args.screenId);
    return { paths };
  });
}
