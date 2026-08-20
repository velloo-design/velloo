import { styleChannelOf } from "@velloo/provider";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { badRequest, type MutationError } from "./errors.ts";
import {
  getComponentNode,
  getScreen,
  providerForScreen,
  resolveWithSnippetHint,
} from "./lookup.ts";
import { commitScreen } from "./persist.ts";
import type { UpdatePropsResult } from "./update-props.ts";

export interface SetStyleArgs {
  screenId: string;
  path: Locator;
  /**
   * Channel-typed style payload, interpreted by the screen's active framework
   * adapter: a className string for Tailwind (shadcn), an object of properties
   * for the `sx` (MUI) and `style` channels. `null` clears the style entirely.
   * Object channels merge shallowly; an inner `null` removes that one key.
   */
  style: string | Record<string, unknown> | null;
}

/**
 * Set a node's style through the screen's *native* channel — the framework
 * adapter decides whether that's Tailwind `className`, MUI `sx`, or a plain
 * `style` object (see `decisions.md` #34 / docs/framework-native.md). The
 * agent uses one verb regardless of framework; the tool routes the payload to
 * the right prop and rejects a payload whose shape doesn't fit the channel.
 */
export async function setStyle(
  ctx: MutationContext,
  args: SetStyleArgs,
): Promise<Result<UpdatePropsResult, MutationError>> {
  const { screenId, path, style } = args;

  const screenR = getScreen(ctx, screenId);
  if (!screenR.ok) return screenR;
  const channel = styleChannelOf(providerForScreen(ctx, screenR.value));
  const prop = channel.prop;

  const wantsString = channel.kind === "tailwind-classname";
  if (wantsString && style !== null && typeof style !== "string") {
    return err(
      badRequest(
        `set_style on the "${channel.kind}" channel expects \`style\` to be a className string (got ${typeof style}).`,
      ),
    );
  }
  if (!wantsString && style !== null && (typeof style !== "object" || Array.isArray(style))) {
    return err(
      badRequest(
        `set_style on the "${channel.kind}" channel expects \`style\` to be an object of ${prop} properties (got ${Array.isArray(style) ? "array" : typeof style}).`,
      ),
    );
  }

  return DoAsync<UpdatePropsResult, MutationError>(async function* () {
    const next = cloneScreen(screenR.value);
    const resolved = yield* $(resolveWithSnippetHint(ctx, next.tree, path, screenId));
    const node = yield* $(getComponentNode(next.tree, resolved, screenId));

    const props: Record<string, unknown> = { ...(node.props ?? {}) };
    if (style === null) {
      delete props[prop];
    } else if (typeof style === "string") {
      const trimmed = style.trim();
      if (trimmed === "") delete props[prop];
      else props[prop] = trimmed;
    } else {
      const current = props[prop];
      const merged: Record<string, unknown> =
        current && typeof current === "object" && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      for (const [k, v] of Object.entries(style)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length === 0) delete props[prop];
      else props[prop] = merged;
    }

    if (Object.keys(props).length === 0) delete node.props;
    else node.props = props;

    yield* $(await commitScreen(ctx.folder, screenId, next));
    broadcastTreeChange(ctx, screenId);
    return { path: resolved };
  });
}
