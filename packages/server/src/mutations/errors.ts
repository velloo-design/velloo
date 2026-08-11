export type MutationErrorCode =
  | "INVALID_PATH"
  | "UNKNOWN_COMPONENT"
  | "INVALID_PROPS"
  | "LOCKED_VERSION_MISMATCH"
  | "RENDER_ERROR"
  | "PAGE_NOT_FOUND"
  | "VARIANT_NOT_FOUND";

export interface MutationErrorPayload {
  code: MutationErrorCode;
  message: string;
  /** Path that triggered the error, when relevant. */
  path?: number[];
  /** Component ref that triggered the error. */
  ref?: string;
  /** Closest matches by Levenshtein for UNKNOWN_COMPONENT. */
  suggestions?: string[];
  /** Schema for INVALID_PROPS — currently the raw type strings from the manifest. */
  schema?: Record<string, string>;
}

export class MutationError extends Error {
  readonly payload: MutationErrorPayload;

  constructor(payload: MutationErrorPayload) {
    super(payload.message);
    this.name = "MutationError";
    this.payload = payload;
  }
}

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
