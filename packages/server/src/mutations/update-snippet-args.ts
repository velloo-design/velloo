import { $, DoAsync, err, type Result } from "@velloo/result";
import { isSnippetInstance } from "@velloo/schema";
import type { Locator } from "../path.ts";
import { cloneScreen } from "./clone.ts";
import type { MutationContext } from "./context.ts";
import { invalidPath, type MutationError } from "./errors.ts";
import { getNode, getScreen, resolve } from "./lookup.ts";
import { commitScreen } from "./persist.ts";

export interface UpdateSnippetArgsArgs {
  screenId: string;
  path: Locator;
  argPatch: Record<string, unknown>;
  /** Pass `null` to clear, omit to leave unchanged. */
  extraClassName?: string | null;
}

export interface UpdateSnippetArgsResult {
  path: number[];
}

export async function updateSnippetArgs(
  ctx: MutationContext,
  args: UpdateSnippetArgsArgs,
): Promise<Result<UpdateSnippetArgsResult, MutationError>> {
  return DoAsync<UpdateSnippetArgsResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const next = cloneScreen(screen);

    const resolved = yield* $(resolve(next.tree, args.path, args.screenId));
    const node = yield* $(getNode(next.tree, resolved, args.screenId));
    if (!isSnippetInstance(node)) {
      return yield* $(
        err(
          invalidPath(`Node at ${JSON.stringify(resolved)} is not a snippet instance.`, resolved),
        ),
      );
    }

    const merged: Record<string, unknown> = { ...(node.args ?? {}) };
    for (const [k, v] of Object.entries(args.argPatch)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    if (Object.keys(merged).length === 0) delete node.args;
    else node.args = merged;

    if (args.extraClassName !== undefined) {
      if (args.extraClassName === null || args.extraClassName.trim() === "") {
        delete node.$extraClassName;
      } else {
        node.$extraClassName = args.extraClassName.trim();
      }
    }

    yield* $(await commitScreen(ctx.folder, args.screenId, next));
    ctx.broadcast({ type: "screen-changed", screenId: args.screenId });
    return { path: resolved };
  });
}
