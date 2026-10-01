import type { ComponentNode, RepoComponentRef } from "@velloo/schema";
import type { MutationContext } from "../mutations/context.ts";
import type { RepoCatalogEntry } from "./catalog.ts";

/**
 * Turn what an agent wrote into a repository node's identity: an explicit
 * `repo` identity wins; otherwise a catalog id (`Tabs.List`, `Mantine.Button`)
 * names one. A bare name only gets here once `ensureKnownComponent` has found
 * it unresolved, and a colliding repository family carries a qualified id.
 */
export async function resolveRepoRef(
  ctx: MutationContext,
  ref: string,
  explicit?: RepoComponentRef,
): Promise<Pick<ComponentNode, "$ref" | "$repo"> | null> {
  if (explicit) {
    const entry = await catalogEntry(ctx, (e) => sameIdentity(e.identity, explicit));
    return {
      $ref:
        entry?.name ??
        [explicit.exportName === "default" ? ref : explicit.exportName, explicit.member]
          .filter(Boolean)
          .join("."),
      $repo: withProxy(explicit, entry),
    };
  }
  const entry = await catalogEntry(ctx, (e) => e.id === ref);
  return entry ? { $ref: entry.name, $repo: withProxy(entry.identity, entry) } : null;
}

async function catalogEntry(
  ctx: MutationContext,
  match: (entry: RepoCatalogEntry) => boolean,
): Promise<RepoCatalogEntry | undefined> {
  if (!ctx.repo) return undefined;
  try {
    return (await ctx.repo.catalog()).entries.find(match);
  } catch {
    return undefined;
  }
}

function sameIdentity(a: RepoComponentRef, b: RepoComponentRef): boolean {
  return (
    a.importPath === b.importPath &&
    a.exportName === b.exportName &&
    (a.member ?? "") === (b.member ?? "") &&
    (a.app ?? "") === (b.app ?? "")
  );
}

/** A proxy the checked-in overrides assign travels onto the node. */
function withProxy(
  identity: RepoComponentRef,
  entry: RepoCatalogEntry | undefined,
): RepoComponentRef {
  return entry?.proxy && !identity.proxy ? { ...identity, proxy: entry.proxy } : identity;
}
