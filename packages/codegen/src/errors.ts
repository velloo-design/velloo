/**
 * Codegen hard-failure modes — screen lookup or unknown $ref. Format / lint /
 * parse errors stay in EmitCodeResult.errors[] because they're multi-valued,
 * informational, and don't gate writes the same way.
 */
export type CodegenError =
  | { kind: "ScreenNotFound"; screenId: string }
  | { kind: "UnknownComponent"; ref: string }
  | { kind: "SnippetNotFound"; snippetId: string };

export const screenNotFound = (screenId: string): CodegenError => ({
  kind: "ScreenNotFound",
  screenId,
});
export const unknownComponent = (ref: string): CodegenError => ({
  kind: "UnknownComponent",
  ref,
});
export const snippetNotFound = (snippetId: string): CodegenError => ({
  kind: "SnippetNotFound",
  snippetId,
});
