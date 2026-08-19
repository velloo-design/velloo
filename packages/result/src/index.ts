/**
 * Lightweight Result<T, E> for explicit, type-safe error handling.
 *
 * Tagged-union errors with `kind` as the discriminant — pair with switch +
 * `const _: never = error` to get compiler-enforced exhaustiveness across the
 * callers of any Result-returning API.
 *
 * Compose via:
 *   - async chains: `DoAsync` (the workhorse — reads like async/await) with `$`
 *   - boundaries: `tryCatchAsync` to lift throwing async APIs into Result
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

// ---------------------------------------------------------------------------
// Terminal consumers
// ---------------------------------------------------------------------------

/** Returns the value or throws — escape hatch for tests / boundaries. */
export function unwrap<T, E>(r: Result<T, E>, message?: string): T {
  if (r.ok) return r.value;
  const msg = message ?? `unwrap: ${JSON.stringify(r.error)}`;
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Boundary wrappers — lift throwing APIs into Result
// ---------------------------------------------------------------------------

export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (e: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    return err(onError(thrown));
  }
}

// ---------------------------------------------------------------------------
// Generator-based do-notation
// ---------------------------------------------------------------------------

/**
 * Adapter used inside DoAsync blocks via `yield* $(...)`.
 * On ok, returns the unwrapped value to the generator.
 * On err, yields the err so DoAsync can short-circuit.
 */
export function* $<T, E>(r: Result<T, E>): Generator<Result<never, E>, T, unknown> {
  if (!r.ok) {
    yield r as Result<never, E>;
    // Unreachable: DoAsync exits after the first err and never resumes.
    // Throw is the cheapest way to satisfy the "must return T" check.
    throw new Error("unreachable: generator resumed after err");
  }
  return r.value;
}

export async function DoAsync<T, E>(
  gen: () => AsyncGenerator<Result<never, E>, T, unknown>,
): Promise<Result<T, E>> {
  const iter = gen();
  let step = await iter.next();
  while (!step.done) {
    const r = step.value;
    if (!r.ok) return r;
    step = await iter.next(r.value);
  }
  return ok(step.value);
}
