import { renderBody } from "@velloo/renderer";
import { $, DoAsync, type Result } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import type { Locator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getScreen, registryForScreen } from "./lookup.ts";

export interface InspectArgs {
  screenId: string;
  path: Locator;
}

export interface InspectResult {
  ref: string;
  resolvedProps: Record<string, unknown>;
  classes: string[];
  /** SSR'd HTML for the subtree (no surrounding document). */
  bodyHtml: string;
}

export async function inspect(
  ctx: MutationContext,
  args: InspectArgs,
): Promise<Result<InspectResult, MutationError>> {
  return DoAsync<InspectResult, MutationError>(async function* () {
    const screen = yield* $(getScreen(ctx, args.screenId));
    const node = yield* $(getComponentNode(screen.tree, args.path, args.screenId));

    const subScreen: Screen = {
      id: `${screen.id}__inspect`,
      name: `${screen.name} inspect`,
      library: screen.library,
      tree: node,
    };
    const bodyHtml = renderBody(subScreen, registryForScreen(ctx, subScreen), ctx.folder.snippets);

    const className = (node.props?.className ?? "") as string;
    const classes =
      typeof className === "string" ? className.trim().split(/\s+/).filter(Boolean) : [];

    return {
      ref: node.$ref,
      resolvedProps: { ...(node.props ?? {}) },
      classes,
      bodyHtml,
    };
  });
}
