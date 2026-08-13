/**
 * Codegen hard-failure modes — variant lookup or unknown $ref. Format / lint /
 * parse errors stay in EmitCodeResult.errors[] because they're multi-valued,
 * informational, and don't gate writes the same way (the result still carries
 * the unformatted code + diff for the caller to inspect).
 */
export type CodegenError =
  | { kind: "VariantNotFound"; variantId: string }
  | { kind: "UnknownComponent"; ref: string }
  | { kind: "SnippetNotFound"; snippetId: string };

export const variantNotFound = (variantId: string): CodegenError => ({
  kind: "VariantNotFound",
  variantId,
});
export const unknownComponent = (ref: string): CodegenError => ({
  kind: "UnknownComponent",
  ref,
});
export const snippetNotFound = (snippetId: string): CodegenError => ({
  kind: "SnippetNotFound",
  snippetId,
});
