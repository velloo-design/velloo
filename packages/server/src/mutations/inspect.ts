import { renderBody } from "@velloo/renderer";
import { $, DoAsync, type Result } from "@velloo/result";
import type { Variant } from "@velloo/schema";
import type { Locator } from "../path.ts";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { getComponentNode, getPage, getVariant } from "./lookup.ts";

export interface InspectArgs {
  pageId: string;
  variantId: string;
  /** Locator — path array or `"@id"` string. */
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
    const page = yield* $(getPage(ctx, args.pageId));
    const variant = yield* $(getVariant(page, args.pageId, args.variantId));
    const node = yield* $(getComponentNode(variant.tree, args.path, args.pageId, args.variantId));

    // Render only the subtree by faking a Variant with that node as root.
    const subVariant: Variant = {
      id: `${variant.id}__inspect`,
      name: `${variant.name} inspect`,
      viewport: variant.viewport,
      tree: node,
    };
    const bodyHtml = renderBody(subVariant, ctx.folder.snippets);

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
