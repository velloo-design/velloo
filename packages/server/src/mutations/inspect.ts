import { renderVariant } from "@velloo/renderer";
import { $, DoAsync, ok, type Result } from "@velloo/result";
import type { Variant } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getNode, getPage, getVariant } from "./lookup.ts";

export interface InspectArgs {
  pageId: string;
  variantId: string;
  path: number[];
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
    const page = yield* $(getPage(ctx, args.pageId));
    const variant = yield* $(getVariant(page, args.pageId, args.variantId));
    const node = yield* $(getNode(variant.tree, args.path));

    // Render only the subtree by faking a Variant with that node as root.
    const subVariant: Variant = {
      id: `${variant.id}__inspect`,
      name: `${variant.name} inspect`,
      viewport: variant.viewport,
      tree: node,
    };
    const { bodyHtml } = await renderVariant(subVariant, ctx.folder.theme);

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
