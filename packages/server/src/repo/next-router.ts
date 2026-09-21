/**
 * Next's client navigation hooks read React contexts that only its own router
 * mounts. Outside `next dev` those contexts are absent, so `usePathname()`
 * returns null and an app component that does `pathname.startsWith(...)` throws
 * — taking the app's real chrome (a site header, a nav rail) out of every
 * screen that mounts it, with a render-failed frame in its place.
 *
 * So the canvas provides the contexts itself, with inert defaults, one layer
 * OUTSIDE the design's preview entry: an entry that supplies its own (a
 * pathname that lights the right nav item, say) still wins, and an app that
 * isn't Next is untouched.
 */

export interface NextRouterContexts {
  /** `next/dist/shared/lib/app-router-context.shared-runtime` in the host app. */
  appRouterPath: string;
  /** `next/dist/shared/lib/hooks-client-context.shared-runtime` in the host app. */
  hooksPath: string;
}

/**
 * The host app's own copy of Next's context modules, or null when it isn't a
 * Next app (or is one too old for the app router, where these paths don't
 * exist). Both modules ship inside `next` itself, so resolving them from the
 * app root gives the same instances its components import.
 */
export function resolveNextRouterContexts(hostRoot: string): NextRouterContexts | null {
  const resolve = (specifier: string): string | null => {
    try {
      return Bun.resolveSync(specifier, hostRoot);
    } catch {
      return null;
    }
  };
  const appRouterPath = resolve("next/dist/shared/lib/app-router-context.shared-runtime");
  const hooksPath = resolve("next/dist/shared/lib/hooks-client-context.shared-runtime");
  return appRouterPath && hooksPath ? { appRouterPath, hooksPath } : null;
}
