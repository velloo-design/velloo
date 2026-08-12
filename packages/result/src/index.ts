/**
 * Lightweight Result<T, E> for explicit, type-safe error handling.
 *
 * Tagged-union errors with `kind` as the discriminant — pair with switch +
 * `const _: never = error` to get compiler-enforced exhaustiveness across the
 * callers of any Result-returning API.
 *
 * Compose via:
 *   - synchronous chains: `flatMap`, or the `Do` generator block
 *   - async chains: `DoAsync` (the workhorse — reads like async/await)
 *   - parallel: `combine` (fail-fast, preserves tuple element types)
 *   - boundaries: `tryCatch` / `tryCatchAsync` to lift throwing APIs
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
// Predicates (narrowing type guards)
// ---------------------------------------------------------------------------

export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function mapError<T, E, F>(r: Result<T, E>, fn: (e: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function flatMap<T, U, E, F>(r: Result<T, E>, fn: (v: T) => Result<U, F>): Result<U, E | F> {
  return r.ok ? fn(r.value) : r;
}

// ---------------------------------------------------------------------------
// Transparent side effects
// ---------------------------------------------------------------------------

export function tap<T, E>(r: Result<T, E>, fn: (v: T) => void): Result<T, E> {
  if (r.ok) fn(r.value);
  return r;
}

export function tapError<T, E>(r: Result<T, E>, fn: (e: E) => void): Result<T, E> {
  if (!r.ok) fn(r.error);
  return r;
}

// ---------------------------------------------------------------------------
// Recovery (type-narrowing)
// ---------------------------------------------------------------------------

/**
 * Recover from a specific tagged error, narrowing the remaining error union.
 *
 *   const fixed = catchKind(load(id), "PageNotFound", () => fallback());
 *   //    ^? Result<Page, RemainingErrors>  — PageNotFound gone from the type
 */
export function catchKind<T, E extends { readonly kind: string }, K extends E["kind"], U>(
  r: Result<T, E>,
  kind: K,
  recover: (e: Extract<E, { readonly kind: K }>) => U,
): Result<T | U, Exclude<E, { readonly kind: K }>> {
  if (r.ok) return r;
  if ((r.error as { readonly kind: string }).kind === kind) {
    return ok(recover(r.error as Extract<E, { readonly kind: K }>));
  }
  return r as Result<T, Exclude<E, { readonly kind: K }>>;
}

/** Recover from any error by mapping it to a value. */
export function recover<T, E, U>(r: Result<T, E>, fn: (e: E) => U): Result<T | U, never> {
  return r.ok ? r : ok(fn(r.error));
}

// ---------------------------------------------------------------------------
// Terminal consumers
// ---------------------------------------------------------------------------

export function match<T, E, A, B>(
  r: Result<T, E>,
  handlers: { ok: (v: T) => A; err: (e: E) => B },
): A | B {
  return r.ok ? handlers.ok(r.value) : handlers.err(r.error);
}

/** Returns the value or throws — escape hatch for tests / boundaries. */
export function unwrap<T, E>(r: Result<T, E>, message?: string): T {
  if (r.ok) return r.value;
  const msg = message ?? `unwrap: ${JSON.stringify(r.error)}`;
  throw new Error(msg);
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

// ---------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------

type UnpackOk<R> = R extends Result<infer T, unknown> ? T : never;
type UnpackErr<R> = R extends Result<unknown, infer E> ? E : never;

/**
 * Run several Results together; fail fast on the first err. The success type
 * is a tuple matching the input shape; the error type is the union of every
 * input's error.
 */
export function combine<R extends ReadonlyArray<Result<unknown, unknown>>>(
  results: R,
): Result<{ -readonly [K in keyof R]: UnpackOk<R[K]> }, UnpackErr<R[number]>> {
  const values = [] as unknown[];
  for (const r of results) {
    if (!r.ok) return r as Result<never, UnpackErr<R[number]>>;
    values.push(r.value);
  }
  return ok(values as { -readonly [K in keyof R]: UnpackOk<R[K]> });
}

// ---------------------------------------------------------------------------
// Boundary wrappers — lift throwing APIs into Result
// ---------------------------------------------------------------------------

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
 * Adapter used inside Do / DoAsync blocks via `yield* $(...)`.
 * On ok, returns the unwrapped value to the generator.
 * On err, yields the err so Do / DoAsync can short-circuit.
 */
export function* $<T, E>(r: Result<T, E>): Generator<Result<never, E>, T, unknown> {
  if (!r.ok) {
    yield r as Result<never, E>;
    // Unreachable: Do/DoAsync exits after the first err and never resumes.
    // Throw is the cheapest way to satisfy the "must return T" check.
    throw new Error("unreachable: generator resumed after err");
  }
  return r.value;
}

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
