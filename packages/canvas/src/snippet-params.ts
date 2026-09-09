import type { SnippetParam } from "@velloo/schema";

/**
 * Short form of a param's declared default, for the surfaces that *list*
 * params rather than render them — the editor's params rail, the library
 * detail header. `null` means the param declares none, so it's required and
 * every instance has to supply it. A `node` default is a tree with no useful
 * one-liner, hence the ellipsis.
 */
export function formatParamDefault(param: SnippetParam): string | null {
  if (param.default === undefined) return null;
  if (typeof param.default === "string") return `"${param.default}"`;
  if (typeof param.default === "number" || typeof param.default === "boolean") {
    return String(param.default);
  }
  return "…";
}
