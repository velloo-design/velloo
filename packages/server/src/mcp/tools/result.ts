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
  isError?: true;
};

/** The discriminant every typed error union shares (MutationError, ThemeError, CodegenError). */
export type KindedError = { kind: string };

export function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
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
