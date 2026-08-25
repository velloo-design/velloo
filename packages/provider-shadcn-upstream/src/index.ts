/**
 * `@velloo/provider-shadcn-upstream` — the `shadcn-upstream` ComponentProvider.
 *
 * A pragmatic hybrid: the canvas runtime reuses the `@velloo/shadcn-snapshot`
 * registry (avoiding a 25+ `@radix-ui/*` bundle), while a real vanilla-shadcn
 * install in the user's app is delegated to `npx shadcn@latest add` at handoff.
 * The provider reads a per-cache `manifest.json` when one is present and falls
 * back to the snapshot manifest otherwise.
 */
export { readManifest } from "./manifest.ts";
export { type CreateUpstreamProviderOptions, createProvider } from "./provider.ts";
