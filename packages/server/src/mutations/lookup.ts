import { err, ok, type Result } from "@velloo/result";
import type { Node, Page, Variant } from "@velloo/schema";
import { isKnownComponent, registry } from "@velloo/shadcn-snapshot";
import { pathAt } from "../path.ts";
import type { MutationContext } from "./context.ts";
import {
  invalidPath,
  type MutationError,
  nearestRefs,
  pageNotFound,
  unknownComponent,
  variantNotFound,
} from "./errors.ts";

export function getPage(ctx: MutationContext, pageId: string): Result<Page, MutationError> {
  const page = ctx.folder.pages.get(pageId);
  return page ? ok(page) : err(pageNotFound(pageId));
}

export function getVariant(
  page: Page,
  pageId: string,
  variantId: string,
): Result<Variant, MutationError> {
  const v = page.variants.find((x) => x.id === variantId);
  return v ? ok(v) : err(variantNotFound(pageId, variantId));
}

export function getNode(root: Node, path: number[]): Result<Node, MutationError> {
  const n = pathAt(root, path);
  return n ? ok(n) : err(invalidPath(`No node at path ${JSON.stringify(path)}`, path));
}

export function ensureKnownComponent(ref: string): Result<void, MutationError> {
  if (isKnownComponent(ref)) return ok(undefined);
  return err(unknownComponent(ref, nearestRefs(ref, Object.keys(registry))));
}
