/**
 * Tiny fetch helpers shared across the API layer. All three flavors
 * (mutate, theme, generic POST) read the server's `{error: {...}}`
 * envelope and rethrow a friendly Error with the typed payload
 * attached, so call-sites can `toastError(err)` and get the right
 * message + suggestions.
 */
export interface MutateError {
  code: string;
  message: string;
  path?: number[];
  ref?: string;
  suggestions?: string[];
}

export async function postMutate<T>(op: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/mutate/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(body.error?.message ?? `mutate/${op}: ${res.status}`);
    (err as Error & { code?: string; payload?: MutateError }).payload = body.error;
    throw err;
  }
  return (await res.json()) as T;
}

export async function postTheme<T>(op: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/theme/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    throw new Error(body.error?.message ?? `theme/${op}: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const respBody = (await res.json().catch(() => ({}))) as { error?: MutateError };
    const err = new Error(respBody.error?.message ?? `${path}: ${res.status}`);
    (err as Error & { payload?: MutateError }).payload = respBody.error;
    throw err;
  }
  return (await res.json()) as T;
}
