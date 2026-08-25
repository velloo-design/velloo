import {
  type ComponentProvider,
  type ComponentRegistry,
  type CssFramework,
  type FrameworkAdapter,
  type RenderPass,
  styleChannelOf,
} from "@velloo/provider";
import type { Extension, Screen, Snippet, Theme } from "@velloo/schema";
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
 * Merge the screen's provider's registry with the folder's extension
 * placeholders. Extensions shadow library components with the same id
 * (the agent explicitly registered a custom component, so it wins over
 * a library default).
 */
export function registryForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  extensions: Record<string, Extension>,
  folderCss?: CssFramework,
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
