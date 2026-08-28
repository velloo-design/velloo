/**
 * Re-exported as `@velloo/shadcn-snapshot/version` so version-only consumers
 * — the CLI init wizard and default-config scaffold — don't pull the snapshot
 * registry (radix, echarts, every vendored component) into their import
 * graph. The bundled CLI lazy-loads the full provider per folder config; see
 * `packages/server/src/providers.ts`.
 */
export { snapshotVersion } from "./paths.ts";
