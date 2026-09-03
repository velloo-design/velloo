/**
 * Tiny fetch helpers shared across the API layer. One underlying POST reads
 * the server's `{error: {...}}` envelope and rethrows a friendly Error with
 * the typed payload attached, so call-sites can `toastError(err)` and get
 * the right message + suggestions.
 */
import type { ErrorEnvelope } from "@velloo/protocol";
import { ensureConnected } from "./connection.ts";
import { type ApiError, describeApiError } from "./errors.ts";

export type { ApiError } from "./errors.ts";

/**
 * Read the server's `{error}` envelope. The body is untrusted, so the shape is
 * checked rather than asserted: anything that is not a kinded object yields
 * `undefined` and the caller falls back to its own label.
 */
async function readError(res: Response): Promise<ApiError | undefined> {
  const body: unknown = await res.json().catch(() => undefined);
  if (!body || typeof body !== "object") return undefined;
  const error = (body as Partial<ErrorEnvelope<ApiError>>).error;
  if (!error || typeof error !== "object" || typeof error.kind !== "string") return undefined;
  return error;
}

/** Rethrow a server failure as an Error carrying the typed payload. */
export async function toApiError(res: Response, label: string): Promise<Error> {
  const payload = await readError(res);
  const err = new Error(payload ? describeApiError(payload) : `${label}: ${res.status}`);
  (err as Error & { payload?: ApiError }).payload = payload;
  return err;
}

async function post<T>(url: string, body: unknown, label: string): Promise<T> {
  // Every mutation funnels through here — gate them all while the daemon is
  // unreachable so nothing silently no-ops or half-applies.
  ensureConnected();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res, label);
  return (await res.json()) as T;
}

export async function requestJson<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  ensureConnected();
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await toApiError(res, path);
  return (await res.json()) as T;
}

export function postMutate<T>(op: string, args: unknown): Promise<T> {
  return post<T>(`/api/mutate/${op}`, args, `mutate/${op}`);
}

export function postTheme<T>(op: string, args: unknown): Promise<T> {
  return post<T>(`/api/theme/${op}`, args, `theme/${op}`);
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return post<T>(path, body, path);
}
