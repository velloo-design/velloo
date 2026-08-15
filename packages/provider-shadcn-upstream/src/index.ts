/**
 * `@velloo/provider-shadcn-upstream` — fetches shadcn components from
 * upstream at a pinned version, weaves canvas-safe behavior in through
 * `@velloo/shadcn-adapter`, and exposes the result as a
 * `ComponentProvider`. See `docs/decisions.md` #25.
 *
 * Sprint Z exposes the fetcher + manifest pieces (Phase 2). Phase 3
 * adds the bundler and the actual `createProvider()` factory.
 */
export { SHADCN_COMPONENT_IDS, type ShadcnComponentId } from "./components.ts";
export {
  type FetchOptions,
  type FetchResult,
  fetchShadcn,
  LIB_UTILS_CONTENT,
  type ShadcnRegistryItem,
  verifyCache,
} from "./fetcher.ts";
export { type InstallOptions, type InstallResult, installShadcnUpstream } from "./install.ts";
export {
  aggregateDependencies,
  dateStampVersion,
  hashContent,
  type ShadcnUpstreamLock,
} from "./lock.ts";
export { generateManifest, readManifest, writeManifest } from "./manifest.ts";
export { type CreateUpstreamProviderOptions, createProvider } from "./provider.ts";
