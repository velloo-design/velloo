/**
 * `@velloo/provider-shadcn-upstream` — fetches shadcn components from
 * upstream at a pinned version, weaves canvas-safe behavior in through
 * `@velloo/shadcn-adapter`, and exposes the result as a
 * `ComponentProvider`.
 *
 * Currently exposes the fetcher + manifest pieces; the bundler and the
 * actual `createProvider()` factory are still to come.
 */
export { SHADCN_COMPONENT_IDS, type ShadcnComponentId } from "./components.ts";
export {
  type FetchOptions,
  type FetchResult,
  fetchShadcn,
  LIB_UTILS_CONTENT,
  SHADCN_REGISTRY_VERSION,
  type ShadcnRegistryItem,
  verifyCache,
} from "./fetcher.ts";
export { type InstallOptions, type InstallResult, installShadcnUpstream } from "./install.ts";
export { aggregateDependencies, hashContent, type ShadcnUpstreamLock } from "./lock.ts";
export { generateManifest, readManifest, writeManifest } from "./manifest.ts";
export { type CreateUpstreamProviderOptions, createProvider } from "./provider.ts";
