import { type StyleChannelKind, styleChannelOf } from "@velloo/provider";
import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Node, Screen } from "@velloo/schema";
import { cloneNode, cloneScreen } from "./clone.ts";
import { resolveComponentRefs } from "./component-refs.ts";
import type { MutationContext } from "./context.ts";
import { type MutationError, screenIdConflict, screenIdExhausted } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { persistScreen } from "./persist.ts";
import { slugify } from "./slugify.ts";

/** The empty screen's padding in each style channel — a Tailwind class means nothing without Tailwind. */
const EMPTY_SCREEN_PADDING: Record<StyleChannelKind, unknown> = {
  "tailwind-classname": "p-6",
  sx: { p: 3 },
  style: { padding: "24px" },
};

export interface AddScreenArgs {
  /** Display name. Screen id is slug(name) unless `id` is provided. */
  name: string;
  id?: string | undefined;
  /** If provided, deep-copy the named screen's tree. */
  fromScreenId?: string | undefined;
  /** Otherwise, provide an explicit starting tree. Defaults to a bare Card. */
  tree?: Node | undefined;
  /** The app route this screen stands for, e.g. "/settings/account". */
  route?: string | undefined;
}

export interface AddScreenResult {
  screenId: string;
  screen: Screen;
}

/**
 * Create a new screen. Does *not* place it on the board — the user/agent
 * calls add_frame separately to surface the new screen on the canvas.
 */
export async function addScreen(
  ctx: MutationContext,
  args: AddScreenArgs,
): Promise<Result<AddScreenResult, MutationError>> {
  return DoAsync<AddScreenResult, MutationError>(async function* () {
    const baseId = args.id ?? slugify(args.name, "screen");
    if (args.id !== undefined && ctx.folder.screens.has(args.id)) {
      return yield* $(err(screenIdConflict(args.id)));
    }
    let screenId = baseId;
    let attempt = 2;
    while (ctx.folder.screens.has(screenId)) {
      screenId = `${baseId}-${attempt++}`;
      if (attempt > 100) return yield* $(err(screenIdExhausted(baseId)));
    }

    let tree: Node;
    if (args.fromScreenId !== undefined) {
      const src = yield* $(getScreen(ctx, args.fromScreenId));
      tree = cloneScreen(src).tree;
    } else if (args.tree !== undefined) {
      // Held to what add_node holds one node to: an app component's name gains
      // its `$repo` identity, and a name nothing knows is refused here instead
      // of rendering as a placeholder.
      tree = cloneNode(yield* $(await resolveComponentRefs(ctx, args.tree, null)));
    } else {
      const channel = styleChannelOf(ctx.defaultProvider, ctx.folder.config.styling?.framework);
      tree = { $ref: "Card", props: { [channel.prop]: EMPTY_SCREEN_PADDING[channel.kind] } };
    }

    const screen: Screen = {
      id: screenId,
      name: args.name,
      ...(args.route !== undefined ? { route: args.route } : {}),
      tree,
    };
    await persistScreen(ctx.folder, screenId, screen);
    ctx.broadcast({ type: "screen-changed", screenId });
    return { screenId, screen };
  });
}
