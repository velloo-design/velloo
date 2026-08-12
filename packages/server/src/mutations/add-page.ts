import { err, ok, type Result } from "@velloo/result";
import type { Page } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { type MutationError, pageIdExhausted } from "./errors.ts";
import { persistPage } from "./persist.ts";

export interface AddPageArgs {
  /** Display name. Page id is slug(name) unless `id` is provided. */
  name: string;
  /** Optional explicit page id. */
  id?: string;
  /** Variant viewport for the seeded initial variant. Defaults to mobile. */
  viewport?: { w: number; h: number };
}

export interface AddPageResult {
  pageId: string;
  page: Page;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "page"
  );
}

/** Create a new page with a single bare Card variant. */
export async function addPage(
  ctx: MutationContext,
  args: AddPageArgs,
): Promise<Result<AddPageResult, MutationError>> {
  const baseId = args.id ?? slugify(args.name);
  // Pick a unique id by appending -2, -3, ... if needed.
  let pageId = baseId;
  let attempt = 2;
  while (ctx.folder.pages.has(pageId)) {
    pageId = `${baseId}-${attempt++}`;
    if (attempt > 100) return err(pageIdExhausted(baseId));
  }

  const viewport = args.viewport ?? { w: 390, h: 844 };
  const page: Page = {
    name: args.name,
    variants: [
      {
        id: "mobile",
        name: "Mobile",
        viewport,
        tree: { $ref: "Card", props: { className: "p-6" } },
      },
    ],
  };

  await persistPage(ctx.folder, pageId, page);
  ctx.broadcast({ type: "page-changed", pageId });
  return ok({ pageId, page });
}
