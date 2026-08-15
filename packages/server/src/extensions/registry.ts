import type { ComponentProvider, ComponentRegistry } from "@velloo/provider";
import type { Extension, Screen, Snippet } from "@velloo/schema";
import { createElement } from "react";
import { ExtensionPlaceholder } from "./placeholder.tsx";

/**
 * Pick the component provider a given screen's tree renders against.
 * `screen.library` (Sprint Y) names the library id; absent falls back
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
 * Build a registry of extension placeholder components, one per
 * declared extension. Each entry is a React component that closes
 * over its `Extension` descriptor and renders the canvas-mode
 * placeholder card.
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
    out[id] = (resolvedProps: Record<string, unknown>) =>
      createElement(ExtensionPlaceholder, {
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
 * a library default — see `decisions.md` #24).
 */
export function registryForScreen(
  screen: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  extensions: Record<string, Extension>,
): ComponentRegistry {
  const base = providerForScreen(screen, providers, defaultProvider).registry;
  if (Object.keys(extensions).length === 0) return base;
  return { ...base, ...buildExtensionRegistry(extensions) };
}
