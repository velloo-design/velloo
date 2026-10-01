import { err, ok, type Result } from "@velloo/result";
import type { SnippetParam } from "@velloo/schema";
import { type MutationError, snippetParamMismatch } from "./errors.ts";

/**
 * Attributes static design JSX refuses: React consumes `ref` and `key` itself,
 * and handlers and raw HTML would execute. Compose rejects them on every tag.
 */
export function isExecutableReactAttribute(name: string): boolean {
  return /^on[A-Z]/.test(name) || ["dangerouslySetInnerHTML", "ref", "key"].includes(name);
}

/**
 * A snippet param named like a React-reserved attribute (`ref`, `key`) can be
 * declared, but no compose can ever pass it — the attribute is refused first —
 * so the snippet is unusable from the tool agents place it with. `vellooId` is
 * compose's stable-id attribute and is taken off before args are read.
 */
export function checkSnippetParamNames(
  snippetId: string,
  params: readonly SnippetParam[],
): Result<void, MutationError> {
  const reserved = params
    .map((param) => param.name)
    .filter((name) => isExecutableReactAttribute(name) || name === "vellooId");
  if (reserved.length === 0) return ok(undefined);
  const renames = reserved.map((name) => `"${name}" → "${suggestedRename(name)}"`).join(", ");
  return err(
    snippetParamMismatch(
      snippetId,
      `Reserved param name: ${reserved.map((name) => `"${name}"`).join(", ")}. React or compose takes these attributes before a snippet sees them, so no instance could pass one. Rename it (${renames}).`,
    ),
  );
}

function suggestedRename(name: string): string {
  if (name === "ref") return "refId";
  if (name === "key") return "itemKey";
  if (name.startsWith("on")) return `${name.slice(2, 3).toLowerCase()}${name.slice(3)}Action`;
  return `${name}Value`;
}
