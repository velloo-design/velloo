import type { UpdatePropsArgs } from "@velloo/protocol";
import type { StyleChannel } from "@velloo/provider";
import { $, DoAsync, err, ok, type Result } from "@velloo/result";
import { type ComponentNode, isNode, repoKey } from "@velloo/schema";
import { cloneScreen } from "./clone.ts";
import { resolveComponentRefs, shadowedNodesIn } from "./component-refs.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { type MutationError, shadowedComponent } from "./errors.ts";
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
  /**
   * Writes that went through but probably didn't do what was meant: an empty
   * patch, or an object prop replaced whole when only some of its keys were
   * given. Absent when there are none.
   */
  warnings?: string[];
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

    // Every patched node at once, before anything is written. A `null` removes
    // a prop, so only the values being set count.
    const shadowed: Awaited<ReturnType<typeof shadowedNodesIn>> = [];
    for (const { path, propPatch } of args.patches) {
      if (!propPatch) continue;
      const located = resolveWithSnippetHint(ctx, screen.tree, path, args.screenId);
      const target = located.ok
        ? getComponentNode(screen.tree, located.value, args.screenId)
        : null;
      if (!target?.ok || !located.ok) continue;
      const node = target.value;
      const setting = Object.fromEntries(Object.entries(propPatch).filter(([, v]) => v !== null));
      shadowed.push(
        ...(await shadowedNodesIn(
          ctx,
          {
            $ref: node.$ref,
            ...(node.$repo ? { $repo: node.$repo } : {}),
            ...(node.$id !== undefined ? { $id: node.$id } : {}),
            props: setting,
          },
          screen,
          `[${located.value.join(".")}]`,
        )),
      );
    }
    if (shadowed.length > 0) return yield* $(err(shadowedComponent(shadowed)));

    const next = cloneScreen(screen);
    const paths: number[][] = [];
    const warnings: string[] = [];
    for (const { path, propPatch, style } of args.patches) {
      const resolved = yield* $(resolveWithSnippetHint(ctx, next.tree, path, args.screenId));
      const node = yield* $(getComponentNode(next.tree, resolved, args.screenId));
      const channel = style === undefined ? screenChannel : yield* $(channelFor(node, style));
      const checked = yield* $(await resolveComponentRefs(ctx, propPatch ?? {}, screen));
      const at = `[${resolved.join(".")}]`;
      if (style === undefined && Object.keys(checked).length === 0) {
        warnings.push(`${at} propPatch is empty — nothing changed on this node.`);
      }
      const merged: Record<string, unknown> = { ...(node.props ?? {}) };
      for (const [k, v] of Object.entries(checked)) {
        const dropped = droppedKeys(merged[k], v);
        if (dropped.length > 0) {
          // An object payload picks the same channel whatever its keys are.
          const objectChannel = channelFor(node, {});
          const merges = objectChannel.ok && objectChannel.value.prop === k;
          warnings.push(replacedObjectWarning(at, k, dropped, merges));
        }
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
    return warnings.length > 0 ? { paths, warnings } : { paths };
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isNode(value) &&
    !("$if" in value)
  );
}

/**
 * Keys of an object prop that a `propPatch` value replacing it leaves out.
 * `propPatch` sets a prop whole — the canvas inspector writes the complete
 * `style`/`sx` object on every edit and relies on that to delete a key — so an
 * agent's `{ style: { maxWidth } }` silently drops the rest. Naming what went is
 * the only way it can tell.
 */
function droppedKeys(previous: unknown, next: unknown): string[] {
  if (!isPlainRecord(previous) || !isPlainRecord(next)) return [];
  return Object.keys(previous).filter((key) => !(key in next));
}

function replacedObjectWarning(
  at: string,
  prop: string,
  dropped: string[],
  styleMerges: boolean,
): string {
  const fix = styleMerges
    ? `pass the patch's \`style: { … }\` instead, which merges key by key (null removes one)`
    : `include every key you want to keep`;
  return `${at} propPatch.${prop} replaced the whole object, dropping ${dropped.map((k) => `\`${k}\``).join(", ")}. propPatch sets a prop whole; to change only some keys, ${fix}.`;
}
