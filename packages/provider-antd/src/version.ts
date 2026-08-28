/**
 * Lives in its own module (exported as `@velloo/provider-antd/version`) so
 * version-only consumers — the CLI init wizard — don't pull the provider's
 * registry (and with it all of antd) into their import graph. The bundled
 * CLI lazy-loads the full provider per folder config; see
 * `packages/server/src/providers.ts`.
 */
export const ANTD_VERSION = "5" as const;
