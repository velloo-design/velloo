/**
 * Tiny fetch helpers shared across the API layer. One underlying POST reads
 * the server's `{error: {...}}` envelope and rethrows a friendly Error with
 * the typed payload attached, so call-sites can `toastError(err)` and get
 * the right message + suggestions.
 */
import { ensureConnected } from "./connection.ts";

export interface MutateError {
  code: string;
  message: string;
  path?: number[];
  ref?: string;
  suggestions?: string[];
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
  if (!res.ok) {
    const respBody = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(respBody.error?.message ?? `${label}: ${res.status}`);
    (err as Error & { payload?: MutateError }).payload = respBody.error;
    throw err;
  }
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
