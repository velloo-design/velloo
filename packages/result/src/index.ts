/**
 * Lightweight Result<T, E> for explicit, type-safe error handling.
 *
 * Tagged-union errors with `kind` as the discriminant. Exhaustiveness comes
 * from a total `Record<E["kind"], _>` over the union (see the server's
 * `routes/error-http.ts`) or a switch with a `never` guard on the default.
 *
 * Compose via:
 *   - async chains: `DoAsync` (the workhorse — reads like async/await) with `$`
 *   - sync chains: `Do` with `$`
 *   - boundaries: `tryCatch` / `tryCatchAsync` to lift throwing APIs into Result
 *   - crossing error domains: `mapError`
 *   - handling part of a union: `catchKind`
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

/**
 * Translate the error into another domain.
 *
 * The reason this exists: a program with more than one error union needs a
 * declared way to cross between them. Without it the choice is to widen every
 * signature to the union of all domains, or to duplicate the machinery per
 * domain — which is what `routes/route.ts` does, binding the same route helper
 * twice, once per flavour.
 */
export function mapError<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

/**
 * Handle one variant of a kinded error union and narrow what is left.
 *
 * `catchKind(r, "IdNotFound", fallback)` returns a Result whose error type no
 * longer includes `IdNotFound`, so the compiler knows the case is dealt with.
 * The hand-rolled form — `if (r.ok || r.error.kind !== "IdNotFound") return r`
 * — recovers the value but not the narrowing, so callers keep re-handling a
 * case that can no longer happen.
 */
export function catchKind<T, E extends { readonly kind: string }, K extends E["kind"], U>(
  r: Result<T, E>,
  kind: K,
  recover: (error: Extract<E, { readonly kind: K }>) => U,
): Result<T | U, Exclude<E, { readonly kind: K }>> {
  if (r.ok) return r;
  if (r.error.kind === kind) {
    return ok(recover(r.error as Extract<E, { readonly kind: K }>));
  }
  return r as Result<never, Exclude<E, { readonly kind: K }>>;
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

/** Lift a throwing synchronous call into a Result. */
export function tryCatch<T, E>(fn: () => T, onError: (e: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(onError(thrown));
  }
}

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

/** Synchronous sibling of {@link DoAsync}. */
export function Do<T, E>(gen: () => Generator<Result<never, E>, T, unknown>): Result<T, E> {
  const iter = gen();
  let step = iter.next();
  while (!step.done) {
    const r = step.value;
    if (!r.ok) return r;
    step = iter.next(r.value);
  }
  return ok(step.value);
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
