import type { ErrorOf, MutationError } from "@velloo/protocol";

/**
 * Mutation failure modes. The union itself is the canvas's wire contract, so
 * it is declared in `@velloo/protocol`; what lives here are the constructors,
 * which carry agent-facing hint prose and the nearest-component search.
 *
 * Each constructor returns its OWN variant, not the whole union. A function
 * that can only fail one way then says so in its signature, instead of
 * claiming all 28 — which is what makes `catchKind` able to narrow, and what
 * lets a reader see a function's real failure modes without reading its body.
 * The narrow types are assignable to the wide one, so callers that do want
 * `Result<T, MutationError>` are unaffected.
 *
 * Consumers get exhaustiveness from a total `Record<MutationError["kind"], _>`
 * — see `routes/error-http.ts`.
 */
export type { MutationError } from "@velloo/protocol";

// Constructor helpers.
export const screenNotFound = (screenId: string): ErrorOf<MutationError, "ScreenNotFound"> => ({
  kind: "ScreenNotFound",
  screenId,
});
export const boardNotFound = (boardId: string): ErrorOf<MutationError, "BoardNotFound"> => ({
  kind: "BoardNotFound",
  boardId,
});
export const frameNotFound = (
  boardId: string,
  frameId: string,
): ErrorOf<MutationError, "FrameNotFound"> => ({
  kind: "FrameNotFound",
  boardId,
  frameId,
});
export const boardGroupNotFound = (
  groupId: string,
): ErrorOf<MutationError, "BoardGroupNotFound"> => ({
  kind: "BoardGroupNotFound",
  groupId,
});
export const unknownComponent = (
  ref: string,
  suggestions: string[],
  hint?: string,
): ErrorOf<MutationError, "UnknownComponent"> => ({
  kind: "UnknownComponent",
  ref,
  suggestions,
  ...(hint !== undefined ? { hint } : {}),
});
export const invalidPath = (
  reason: string,
  path?: number[],
  hint?: string,
): ErrorOf<MutationError, "InvalidPath"> => ({
  kind: "InvalidPath",
  reason,
  ...(path !== undefined ? { path } : {}),
  ...(hint !== undefined ? { hint } : {}),
});
export const invalidMove = (reason: string): ErrorOf<MutationError, "InvalidMove"> => ({
  kind: "InvalidMove",
  reason,
});
export const lastScreen = (screenId: string): ErrorOf<MutationError, "LastScreen"> => ({
  kind: "LastScreen",
  screenId,
});
export const screenIdConflict = (screenId: string): ErrorOf<MutationError, "ScreenIdConflict"> => ({
  kind: "ScreenIdConflict",
  screenId,
  hint:
    `Screen "${screenId}" already exists (a route-scan may have scaffolded it as a placeholder). ` +
    `Build into it instead with compose { screenId: "${screenId}", mode: "replace", jsx: … }. ` +
    `To replace the screen resource itself, remove_screen then add_screen. ` +
    `To create a separate screen, omit \`id\` (add_screen auto-suffixes a unique one).`,
});
export const screenIdExhausted = (base: string): ErrorOf<MutationError, "ScreenIdExhausted"> => ({
  kind: "ScreenIdExhausted",
  base,
});
export const boardIdConflict = (boardId: string): ErrorOf<MutationError, "BoardIdConflict"> => ({
  kind: "BoardIdConflict",
  boardId,
});
export const boardIdExhausted = (base: string): ErrorOf<MutationError, "BoardIdExhausted"> => ({
  kind: "BoardIdExhausted",
  base,
});
export const frameIdConflict = (
  boardId: string,
  frameId: string,
): ErrorOf<MutationError, "FrameIdConflict"> => ({
  kind: "FrameIdConflict",
  boardId,
  frameId,
});
export const badRequest = (
  message: string,
  issues?: unknown,
): ErrorOf<MutationError, "BadRequest"> => {
  const hint = scalarChildrenHint(issues);
  return {
    kind: "BadRequest",
    message,
    ...(issues !== undefined ? { issues } : {}),
    ...(hint !== undefined ? { hint } : {}),
  };
};

/**
 * Node-level `children` must be an array of nodes; scalar label text belongs
 * in `props.children`. A bare scalar there (`children: "Save"`) is a common
 * first-try shape that Zod rejects with a precise-but-unhelpful "expected
 * array" — this turns that one failure shape into an actionable nudge.
 *
 * Matches only the scalar-as-`children` case: an `invalid_type` issue whose
 * `expected` is `"array"` at a path ending in `children`. Unrelated array
 * errors (and the auto-wrapped `children: ["Save"]` form, which validates)
 * never match.
 *
 * The signal can surface two ways: top-level (the route schema's
 * `z.array(NodeSchema)`) or buried in an `invalid_union`'s nested `errors`
 * (the persist-time `NodeSchema` union, which a batch tree trips) — so the
 * scan recurses into those nested issue lists.
 */
export function scalarChildrenHint(issues: unknown): string | undefined {
  return hasScalarChildrenIssue(issues)
    ? 'Node-level `children` must be an array of nodes. For scalar text, use `props.children` (e.g. props: { children: "Save" }) — or wrap it: children: ["Save"].'
    : undefined;
}

function hasScalarChildrenIssue(issues: unknown): boolean {
  if (!Array.isArray(issues)) return false;
  return issues.some((issue) => {
    if (typeof issue !== "object" || issue === null) return false;
    const i = issue as { code?: unknown; expected?: unknown; path?: unknown; errors?: unknown };
    if (
      i.code === "invalid_type" &&
      i.expected === "array" &&
      Array.isArray(i.path) &&
      i.path.at(-1) === "children"
    ) {
      return true;
    }
    // `invalid_union.errors` is an array of per-branch issue lists.
    return Array.isArray(i.errors) && i.errors.some((branch) => hasScalarChildrenIssue(branch));
  });
}
export const snippetNotFound = (snippetId: string): ErrorOf<MutationError, "SnippetNotFound"> => ({
  kind: "SnippetNotFound",
  snippetId,
});
export const snippetParamMismatch = (
  snippetId: string,
  reason: string,
  details?: unknown,
): ErrorOf<MutationError, "SnippetParamMismatch"> => ({
  kind: "SnippetParamMismatch",
  snippetId,
  reason,
  ...(details !== undefined ? { details } : {}),
});
export const snippetCycle = (
  snippetId: string,
  viaPath: string[],
): ErrorOf<MutationError, "SnippetCycle"> => ({
  kind: "SnippetCycle",
  snippetId,
  viaPath,
});
export const snippetInUse = (
  snippetId: string,
  screenIds: string[],
): ErrorOf<MutationError, "SnippetInUse"> => ({
  kind: "SnippetInUse",
  snippetId,
  screenIds,
});
export const snippetIdConflict = (
  snippetId: string,
): ErrorOf<MutationError, "SnippetIdConflict"> => ({
  kind: "SnippetIdConflict",
  snippetId,
});
export const idNotFound = (
  screenId: string,
  id: string,
  hint?: string,
): ErrorOf<MutationError, "IdNotFound"> => ({
  kind: "IdNotFound",
  screenId,
  id,
  ...(hint !== undefined ? { hint } : {}),
});
export const idConflict = (
  screenId: string,
  id: string,
  paths: number[][],
): ErrorOf<MutationError, "IdConflict"> => ({
  kind: "IdConflict",
  screenId,
  id,
  paths,
});
export const annotationConflict = (
  screenId: string,
  locator: number[] | string,
  existingId: string,
): ErrorOf<MutationError, "AnnotationConflict"> => ({
  kind: "AnnotationConflict",
  screenId,
  locator,
  existingId,
});
export const annotationNotFound = (
  screenId: string,
  annotationId: string,
): ErrorOf<MutationError, "AnnotationNotFound"> => ({
  kind: "AnnotationNotFound",
  screenId,
  annotationId,
});
export const canvasNoteNotFound = (
  noteId: string,
): ErrorOf<MutationError, "CanvasNoteNotFound"> => ({
  kind: "CanvasNoteNotFound",
  noteId,
});
export const extensionIdConflict = (
  extensionId: string,
): ErrorOf<MutationError, "ExtensionIdConflict"> => ({
  kind: "ExtensionIdConflict",
  message: `Extension "${extensionId}" already exists. Use update_extension to patch it.`,
  extensionId,
});
export const extensionNotFound = (
  extensionId: string,
): ErrorOf<MutationError, "ExtensionNotFound"> => ({
  kind: "ExtensionNotFound",
  message: `Extension "${extensionId}" doesn't exist.`,
  extensionId,
});
export const extensionInUse = (
  extensionId: string,
  references: { screenId: string; path: string }[],
): ErrorOf<MutationError, "ExtensionInUse"> => ({
  kind: "ExtensionInUse",
  message: `Extension "${extensionId}" is referenced by ${references.length} node${references.length === 1 ? "" : "s"} — remove the usages first.`,
  extensionId,
  references,
});

/**
 * Levenshtein distance for ranking nearest component names.
 */
function levenshtein(a: string, b: string): number {
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
      dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[bl] ?? 0;
}

/** Normalize for fuzzy matching: case- and separator-insensitive (SiteHeader ↔ site-header). */
export const normalizeRef = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function nearestRefs(target: string, refs: string[], n = 3): string[] {
  const t = normalizeRef(target);
  return refs
    .map((r) => ({ r, d: levenshtein(t, normalizeRef(r)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.r);
}
