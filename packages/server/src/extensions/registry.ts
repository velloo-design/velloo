import {
  type ComponentProvider,
  type ComponentRegistry,
  type CssFramework,
  type FrameworkAdapter,
  type RenderPass,
  styleChannelOf,
} from "@velloo/provider";
import type { Extension, HostApp, Screen, Snippet, Theme } from "@velloo/schema";
import { createElement } from "react";
import { LiveIslandMarker } from "./live-marker.tsx";
import { ExtensionPlaceholder } from "./placeholder.tsx";

/**
 * Pick the component provider a given screen's tree renders against.
 * `screen.library` names the library id; absent falls back
 * to the folder's default. An unknown library id returns the default
 * provider — the resolver upstream should already have surfaced this
 * as a typed error, so the canvas doesn't crash on a stale reference.
 */
export function providerForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
): ComponentProvider {
  if (!screen.library) return defaultProvider;
  return providers[screen.library] ?? defaultProvider;
}

/**
 * Build a registry of extension components, one per declared extension.
 * Each entry closes over its `Extension` descriptor and renders either
 * the static placeholder card (default) or — for `render:"live"` — a
 * live-island marker the client runtime mounts the real host component
 * into. Both render the same placeholder as their SSR skeleton, so the
 * server-rendered output is identical until the client takes over.
 *
 * Returned as a `ComponentRegistry` so it merges cleanly with a
 * provider's own registry via `{ ...provider.registry, ...buildExtensionRegistry(...) }`.
 *
 * Empty input → empty output, never `null` — keeps the merging
 * call site one-liner safe.
 */
export function buildExtensionRegistry(extensions: Record<string, Extension>): ComponentRegistry {
  const out: ComponentRegistry = {};
  for (const [id, extension] of Object.entries(extensions)) {
    const Component = extension.render === "live" ? LiveIslandMarker : ExtensionPlaceholder;
    out[id] = (resolvedProps: Record<string, unknown>) =>
      createElement(Component, {
        id,
        extension,
        resolvedProps,
        "data-node-path": resolvedProps["data-node-path"] as string | undefined,
        className:
          typeof resolvedProps.className === "string" ? resolvedProps.className : undefined,
      });
  }
  return out;
}

/**
 * Refs no browser bundle can ever have a source for, mapped to what stands in
 * for each inside a mount. Declared up front rather than discovered as a build
 * failure, so the bundle can draw them from their server render and still mount
 * every other component on the screen for real.
 */
export type StaticRefNotes = ReadonlyMap<string, string>;

/**
 * The folder's extensions as refs no browser bundle can ever have a source for,
 * each with what stands in for it inside a mount. Velloo has no implementation
 * of an extension — that is what makes it one — so a screen that uses one keeps
 * its mount and draws the extension from its server render, instead of dropping
 * every other component on the screen back to SSR with it.
 *
 * The two kinds read differently and must say so: a static extension really is
 * only ever the placeholder card, while a live island's placeholder is a
 * skeleton the real host component mounts over moments later.
 */
export function extensionStaticRefs(
  extensions: Record<string, Extension> | undefined,
): StaticRefNotes {
  const out = new Map<string, string>();
  for (const [id, extension] of Object.entries(extensions ?? {})) {
    out.set(
      id,
      extension.render === "live"
        ? 'An extension with render:"live". The canvas draws its placeholder from the server render inside the mount, and the live-island runtime then mounts the real component from the app over it — so what you see is the real thing, but nothing here establishes that it rendered; a screenshot\'s components report says what the mount found.'
        : 'An extension: Velloo has no implementation of it, so the canvas draws the labelled placeholder card from the server render inside the mount. emit_code still emits the real import, so the app renders the actual component. Set render:"live" to preview the real one on the canvas.',
    );
  }
  return out;
}

/**
 * Merge the screen's provider's registry with the folder's extension
 * placeholders, in the order `resolveNodeIdentity` (`@velloo/provider`)
 * resolves them.
 */
export function registryForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  extensions: Record<string, Extension>,
  // Required, though it may be undefined: left out, a no-CSS-framework folder
  // silently renders the Tailwind-classed components its stylesheet never defines.
  folderCss: CssFramework | undefined,
): ComponentRegistry {
  const provider = providerForScreen(screen, providers, defaultProvider) as FrameworkAdapter;
  // The provider may ship channel-specific components (none: inline-styled for the
  // `style` channel vs Tailwind-classed otherwise). Resolve the screen's channel
  // from the folder's CSS framework and pick the matching registry.
  const channel = styleChannelOf(provider, folderCss);
  const base = provider.registryForChannel?.(channel.kind) ?? provider.registry;
  if (Object.keys(extensions).length === 0) return base;
  return { ...base, ...buildExtensionRegistry(extensions) };
}

/**
 * The render pass for a screen's framework adapter (e.g. MUI's emotion pass),
 * or undefined for Tailwind-class frameworks (shadcn / no-lib) whose SSR needs
 * no wrapping. Threaded into `renderScreen` so a MUI screen's emotion CSS is
 * extracted into the document.
 */
export function renderPassForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  theme: Theme,
  dark = false,
): RenderPass | undefined {
  const provider = providerForScreen(screen, providers, defaultProvider) as FrameworkAdapter;
  return provider.renderPass?.(theme, dark);
}

/**
 * The app's stylesheets a screen is styled by, when its adapter is styled by
 * the host app's own files — undefined otherwise. Every render site resolves
 * them here so a design looks the same wherever it renders.
 */
export function hostStylesheetsForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  hostApp: HostApp | undefined,
): string[] | undefined {
  const provider = providerForScreen(screen, providers, defaultProvider) as FrameworkAdapter;
  return provider.hostStylesheets ? (hostApp?.stylesheets ?? []) : undefined;
}
