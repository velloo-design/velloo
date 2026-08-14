# @velloo/result

Tiny `Result<T, E>` helper. Used throughout Velloo so mutations and theme operations return typed errors instead of throwing.

- `ok(value)` / `err(error)` — construct
- `unwrap(result)` — extract success or throw (use in tests + at top-level entry points)
- `Do(function*() { … })` / `DoAsync(async function*() { … })` — generator-monad sugar so chained operations short-circuit on the first `err`. Inside a `Do` block, `yield* $(result)` extracts the value or aborts the block.

No dependencies. Consumed by everything that wraps fallible work.
