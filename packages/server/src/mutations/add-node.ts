import { $, DoAsync, err, type Result } from "@velloo/result";
import type { ComponentNode, Node } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import { broadcastTreeChange, type MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { ensureKnownComponent, getComponentNode, getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface AddNodeArgs {
  screenId: string;
  parentPath: Locator;
  componentRef: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: Node[];
  index?: number;
  /**
   * Mark this node a host-component facade: the canvas renders the subtree you
   * build here (your approximation of a scanned app component), but `emit_code`
   * emits `<name />` from `importPath` instead — preserving the app's real
   * component. See ComponentNode.$emitAs.
   */
  emitAs?: { name: string; importPath: string };
}

export interface AddNodeResult {
  path: number[];
}

export async function addNode(
  ctx: MutationContext,
  args: AddNodeArgs,
): Promise<Result<AddNodeResult, MutationError>> {
  const { screenId, parentPath, componentRef } = args;
  return DoAsync<AddNodeResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, screenId));
    yield* $(ensureKnownComponent(ctx, componentRef, screen));
    const next = cloneScreen(screen);

    const resolvedParent = yield* $(resolve(next.tree, parentPath, screenId));
    const parent = yield* $(getComponentNode(next.tree, resolvedParent, screenId));
    if (!parent.children) parent.children = [];
    const idx = args.index ?? parent.children.length;
    if (idx < 0 || idx > parent.children.length) {
      return yield* $(
        err(
          invalidPath(
            `index ${idx} out of range for parent with ${parent.children.length} children`,
            resolvedParent,
          ),
        ),
      );
    }

    const newNode: ComponentNode = {
      $ref: componentRef,
      ...(args.id !== undefined ? { $id: args.id } : {}),
      ...(args.props ? { props: args.props } : {}),
      ...(args.children ? { children: args.children } : {}),
      ...(args.emitAs ? { $emitAs: args.emitAs } : {}),
    };
    parent.children.splice(idx, 0, newNode);

    yield* $(await commitScreen(ctx.folder, screenId, next));
    broadcastTreeChange(ctx, screenId);
    return { path: [...resolvedParent, idx] };
  });
}
