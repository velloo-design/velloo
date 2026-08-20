/**
 * Mutation failure modes as a discriminated union. Pair with
 * Result<T, MutationError> across the layer; consumers `switch (error.kind)`
 * with a `const _: never = error` exhaustiveness guard.
 */
export type MutationError =
  | { kind: "ScreenNotFound"; screenId: string }
  | { kind: "BoardNotFound"; boardId: string }
  | { kind: "FrameNotFound"; boardId: string; frameId: string }
  | { kind: "GroupNotFound"; boardId: string; groupId: string }
  | { kind: "UnknownComponent"; ref: string; suggestions: string[] }
  | { kind: "InvalidPath"; reason: string; path?: number[] }
  | { kind: "InvalidMove"; reason: string }
  | { kind: "LastScreen"; screenId: string }
  | { kind: "LastBoard"; boardId: string }
  | { kind: "ScreenInUse"; screenId: string; usage: { boardId: string; frameIds: string[] }[] }
  | { kind: "ScreenIdConflict"; screenId: string }
  | { kind: "ScreenIdExhausted"; base: string }
  | { kind: "BoardIdConflict"; boardId: string }
  | { kind: "BoardIdExhausted"; base: string }
  | { kind: "FrameIdConflict"; boardId: string; frameId: string }
  | { kind: "GroupIdConflict"; boardId: string; groupId: string }
  /** Request body failed zod validation. */
  | { kind: "BadRequest"; message: string; issues?: unknown; hint?: string }
  | { kind: "SnippetNotFound"; snippetId: string }
  | { kind: "SnippetParamMismatch"; snippetId: string; reason: string; details?: unknown }
  | { kind: "SnippetCycle"; snippetId: string; viaPath: string[] }
  | { kind: "SnippetInUse"; snippetId: string; screenIds: string[] }
  | { kind: "SnippetIdConflict"; snippetId: string }
  | { kind: "IdNotFound"; screenId: string; id: string; hint?: string }
  | { kind: "IdConflict"; screenId: string; id: string; paths: number[][] }
  | {
      kind: "AnnotationConflict";
      screenId: string;
      locator: number[] | string;
      existingId: string;
    }
  | { kind: "AnnotationNotFound"; screenId: string; annotationId: string }
  | { kind: "CanvasNoteNotFound"; noteId: string }
  | { kind: "ExtensionIdConflict"; extensionId: string; message: string }
  | { kind: "ExtensionNotFound"; extensionId: string; message: string }
  | {
      kind: "ExtensionInUse";
      extensionId: string;
      message: string;
      references: { screenId: string; path: string }[];
    }
  | {
      kind: "InvalidExtensionProp";
      extensionId: string;
      message: string;
      prop: string;
    };

// Constructor helpers.
export const screenNotFound = (screenId: string): MutationError => ({
  kind: "ScreenNotFound",
  screenId,
});
export const boardNotFound = (boardId: string): MutationError => ({
  kind: "BoardNotFound",
  boardId,
});
export const frameNotFound = (boardId: string, frameId: string): MutationError => ({
  kind: "FrameNotFound",
  boardId,
  frameId,
});
export const groupNotFound = (boardId: string, groupId: string): MutationError => ({
  kind: "GroupNotFound",
  boardId,
  groupId,
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
export const lastScreen = (screenId: string): MutationError => ({
  kind: "LastScreen",
  screenId,
});
export const lastBoard = (boardId: string): MutationError => ({
  kind: "LastBoard",
  boardId,
});
export const screenInUse = (
  screenId: string,
  usage: { boardId: string; frameIds: string[] }[],
): MutationError => ({
  kind: "ScreenInUse",
  screenId,
  usage,
});
export const screenIdConflict = (screenId: string): MutationError => ({
  kind: "ScreenIdConflict",
  screenId,
});
export const screenIdExhausted = (base: string): MutationError => ({
  kind: "ScreenIdExhausted",
  base,
});
export const boardIdConflict = (boardId: string): MutationError => ({
  kind: "BoardIdConflict",
  boardId,
});
export const boardIdExhausted = (base: string): MutationError => ({
  kind: "BoardIdExhausted",
  base,
});
export const frameIdConflict = (boardId: string, frameId: string): MutationError => ({
  kind: "FrameIdConflict",
  boardId,
  frameId,
});
export const groupIdConflict = (boardId: string, groupId: string): MutationError => ({
  kind: "GroupIdConflict",
  boardId,
  groupId,
});
export const badRequest = (message: string, issues?: unknown): MutationError => {
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
export const snippetNotFound = (snippetId: string): MutationError => ({
  kind: "SnippetNotFound",
  snippetId,
});
export const snippetParamMismatch = (
  snippetId: string,
  reason: string,
  details?: unknown,
): MutationError => ({
  kind: "SnippetParamMismatch",
  snippetId,
  reason,
  ...(details !== undefined ? { details } : {}),
});
export const snippetCycle = (snippetId: string, viaPath: string[]): MutationError => ({
  kind: "SnippetCycle",
  snippetId,
  viaPath,
});
export const snippetInUse = (snippetId: string, screenIds: string[]): MutationError => ({
  kind: "SnippetInUse",
  snippetId,
  screenIds,
});
export const snippetIdConflict = (snippetId: string): MutationError => ({
  kind: "SnippetIdConflict",
  snippetId,
});
export const idNotFound = (screenId: string, id: string, hint?: string): MutationError => ({
  kind: "IdNotFound",
  screenId,
  id,
  ...(hint !== undefined ? { hint } : {}),
});
export const idConflict = (screenId: string, id: string, paths: number[][]): MutationError => ({
  kind: "IdConflict",
  screenId,
  id,
  paths,
});
export const annotationConflict = (
  screenId: string,
  locator: number[] | string,
  existingId: string,
): MutationError => ({
  kind: "AnnotationConflict",
  screenId,
  locator,
  existingId,
});
export const annotationNotFound = (screenId: string, annotationId: string): MutationError => ({
  kind: "AnnotationNotFound",
  screenId,
  annotationId,
});
export const canvasNoteNotFound = (noteId: string): MutationError => ({
  kind: "CanvasNoteNotFound",
  noteId,
});
export const extensionIdConflict = (extensionId: string): MutationError => ({
  kind: "ExtensionIdConflict",
  message: `Extension "${extensionId}" already exists. Use update_extension to patch it.`,
  extensionId,
});
export const extensionNotFound = (extensionId: string): MutationError => ({
  kind: "ExtensionNotFound",
  message: `Extension "${extensionId}" doesn't exist.`,
  extensionId,
});
export const extensionInUse = (
  extensionId: string,
  references: { screenId: string; path: string }[],
): MutationError => ({
  kind: "ExtensionInUse",
  message: `Extension "${extensionId}" is referenced by ${references.length} node${references.length === 1 ? "" : "s"} — remove the usages first.`,
  extensionId,
  references,
});

/**
 * Levenshtein distance for ranking nearest component names.
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
      dp[j] = Math.min((dp[j] ?? 0) + 1, (dp[j - 1] ?? 0) + 1, prev + cost);
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
