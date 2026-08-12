/**
 * Mutation failure modes as a discriminated union (kind-keyed). Pair with
 * Result<T, MutationError> across the layer; consumers `switch (error.kind)`
 * with a `const _: never = error` exhaustiveness guard so a new variant
 * breaks the build at every call site that doesn't handle it.
 */
export type MutationError =
  | { kind: "PageNotFound"; pageId: string }
  | { kind: "VariantNotFound"; pageId: string; variantId: string }
  | { kind: "UnknownComponent"; ref: string; suggestions: string[] }
  | { kind: "InvalidPath"; reason: string; path?: number[] }
  | { kind: "InvalidMove"; reason: string }
  | { kind: "LastPage"; pageId: string }
  | { kind: "LastVariant"; pageId: string }
  | { kind: "VariantIdConflict"; pageId: string; id: string }
  | { kind: "PageIdExhausted"; base: string };

// Constructor helpers — keep mutation bodies readable.
export const pageNotFound = (pageId: string): MutationError => ({
  kind: "PageNotFound",
  pageId,
});
export const variantNotFound = (pageId: string, variantId: string): MutationError => ({
  kind: "VariantNotFound",
  pageId,
  variantId,
});
export const unknownComponent = (ref: string, suggestions: string[]): MutationError => ({
  kind: "UnknownComponent",
  ref,
  suggestions,
});
export const invalidPath = (reason: string, path?: number[]): MutationError => ({
  kind: "InvalidPath",
  reason,
  ...(path !== undefined ? { path } : {}),
});
export const invalidMove = (reason: string): MutationError => ({
  kind: "InvalidMove",
  reason,
});
export const lastPage = (pageId: string): MutationError => ({ kind: "LastPage", pageId });
export const lastVariant = (pageId: string): MutationError => ({
  kind: "LastVariant",
  pageId,
});
export const variantIdConflict = (pageId: string, id: string): MutationError => ({
  kind: "VariantIdConflict",
  pageId,
  id,
});
export const pageIdExhausted = (base: string): MutationError => ({
  kind: "PageIdExhausted",
  base,
});

/**
 * Levenshtein distance for ranking nearest component names. Tiny implementation;
 * we only call it on strings under ~30 chars so quadratic cost is irrelevant.
 */
export function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        (dp[j] ?? 0) + 1, // deletion
        (dp[j - 1] ?? 0) + 1, // insertion
        prev + cost, // substitution
      );
      prev = tmp;
    }
  }
  return dp[bl] ?? 0;
}

export function nearestRefs(target: string, refs: string[], n = 3): string[] {
  return refs
    .map((r) => ({ r, d: levenshtein(target.toLowerCase(), r.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.r);
}
