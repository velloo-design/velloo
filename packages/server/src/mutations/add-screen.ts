import { $, DoAsync, err, type Result } from "@velloo/result";
import type { Node, Screen } from "@velloo/schema";
import { cloneNode, cloneScreen } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { type MutationError, screenIdConflict, screenIdExhausted } from "./errors.ts";
import { getScreen } from "./lookup.ts";
import { persistScreen } from "./persist.ts";
import { slugify } from "./slugify.ts";

export interface AddScreenArgs {
  /** Display name. Screen id is slug(name) unless `id` is provided. */
  name: string;
  id?: string | undefined;
  /** If provided, deep-copy the named screen's tree. */
  fromScreenId?: string | undefined;
  /** Otherwise, provide an explicit starting tree. Defaults to a bare Card. */
  tree?: Node | undefined;
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
      tree = cloneNode(args.tree);
    } else {
      tree = { $ref: "Card", props: { className: "p-6" } };
    }

    const screen: Screen = { id: screenId, name: args.name, tree };
    await persistScreen(ctx.folder, screenId, screen);
    ctx.broadcast({ type: "screen-changed", screenId });
    return { screenId, screen };
  });
}
