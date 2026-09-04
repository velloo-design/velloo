import type { Result } from "@velloo/result";

/**
 * The MCP tool result envelope, shared by every tool file (the same
 * import-from-here charter as schemas.ts). One envelope shape and ONE error
 * shape: an error's text payload is always a JSON-stringified kinded object
 * (`{ kind: "…", … }`) — never bare prose — so an agent can branch on `kind`
 * uniformly across tools.
 */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type McpResult = {
  content: McpContent[];
  isError?: true | undefined;
  /**
   * The result as data, for tools that declare an `outputSchema` (see
   * outputs.ts). The SDK validates it against that schema and refuses a
   * declared tool that omits it, so the two always move together. The text
   * block stays: it is what a text-only agent actually reads.
   */
  structuredContent?: Record<string, unknown> | undefined;
};

/** The discriminant every typed error union shares (MutationError, ThemeError, CodegenError). */
export type KindedError = { kind: string };

export function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * A success from a tool that declares an `outputSchema`: the same JSON text
 * block every other tool returns, plus the structured copy the schema
 * describes. `extra` appends content blocks (a screenshot alongside its
 * metrics).
 */
export function structuredResult(
  value: Record<string, unknown>,
  ...extra: McpContent[]
): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }, ...extra],
    structuredContent: value,
  };
}

/**
 * Error envelope. A kinded error object ships verbatim; a bare string is
 * wrapped as `{ kind: "Error", message }` so ad-hoc failures carry the same
 * structured shape as typed ones. (Generic so a fresh `{ kind, …details }`
 * literal doesn't trip excess-property checking.)
 */
export function errorResult<E extends KindedError>(error: string | E): McpResult {
  const kinded = typeof error === "string" ? { kind: "Error", message: error } : error;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(kinded) }] };
}

export function toMcp<T, E extends KindedError>(result: Result<T, E>): McpResult {
  return result.ok ? jsonResult(result.value) : errorResult(result.error);
}
