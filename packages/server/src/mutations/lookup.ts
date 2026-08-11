import type { Node, Page, Variant } from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { pathAt } from "../path.ts";
import type { MutationContext } from "./context.ts";
import { MutationError, nearestRefs } from "./errors.ts";

export function getPageOrThrow(ctx: MutationContext, pageId: string): Page {
  const page = ctx.folder.pages.get(pageId);
  if (!page) {
    throw new MutationError({
      code: "PAGE_NOT_FOUND",
      message: `Page not found: ${JSON.stringify(pageId)}`,
    });
  }
  return page;
}

export function getVariantOrThrow(page: Page, variantId: string): Variant {
  const v = page.variants.find((x) => x.id === variantId);
  if (!v) {
    throw new MutationError({
      code: "VARIANT_NOT_FOUND",
      message: `Variant not found: ${JSON.stringify(variantId)}`,
    });
  }
  return v;
}

export function getNodeOrThrow(root: Node, path: number[]): Node {
  const n = pathAt(root, path);
  if (!n) {
    throw new MutationError({
      code: "INVALID_PATH",
      message: `No node at path ${JSON.stringify(path)}`,
      path,
    });
  }
  return n;
}

export function ensureKnownComponentOrThrow(ref: string): void {
  if (isKnownComponent(ref)) return;
  throw new MutationError({
    code: "UNKNOWN_COMPONENT",
    message: `Unknown component: ${JSON.stringify(ref)}`,
    ref,
    suggestions: nearestRefs(ref, Object.keys(registry)),
  });
}
