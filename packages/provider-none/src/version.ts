/**
 * Version of the no-library primitive set. Bumped on breaking changes
 * to the Box/Stack/Button surface (a renamed prop, a removed variant,
 * a behavior change).
 *
 * Lives in its own module (exported as `@velloo/provider-none/version`) so
 * version-only consumers — the CLI init wizard — don't pull the provider's
 * registry into their import graph.
 */
export const noLibVersion = "0.1.0";
