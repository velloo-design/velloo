import type { Library } from "@velloo/schema";
import type { ComponentType } from "react";
import type { Manifest } from "./manifest.ts";

/**
 * Runtime registry mapping component ids (the `$ref` field in the design
 * JSON) to the React component the renderer mounts. Providers expose one
 * registry per provider instance; the renderer never imports a registry
 * directly — it receives one via `BuildTreeOptions` / `RenderOptions`.
 */
// biome-ignore lint/suspicious/noExplicitAny: registry is heterogeneous by design
export type ComponentRegistry = Record<string, ComponentType<any>>;

/**
 * A component library, normalized. Every Velloo library entry — the
 * embedded shadcn snapshot, no-lib primitives, MUI, a future host-repo
 * scan — implements this interface. The interface is the contract the
 * renderer, TailwindJit, codegen, and the canvas all read through.
 *
 * The shape is deliberately
 * narrow: components, manifest, where the files live on disk for
 * scanning. Per-provider knobs (theme bridging, codegen import paths,
 * canvas shims) get added as the abstraction earns them.
 */
export interface ComponentProvider {
  /** Stable provider id. Matches `Library.id` in `.design/config.json`. */
  id: string;
  /** Version string. Date for shadcn (`2026.05.22`), semver for npm libs. */
  version: string;
  /**
   * Absolute path to the directory the Tailwind JIT should scan for
   * component sources. Tailwind reads these so any utility class used
   * inside a vendored component shows up in compiled CSS even when no
   * page references it directly.
   */
  componentsDir: string;
  /**
   * Absolute path to the Tailwind v4 entry CSS shipped by this provider
   * (with @theme blocks, @custom-variant rules, etc.). The JIT compiles
   * against this and the active design folder.
   */
  styleEntryPath: string;
  /** Runtime component registry. */
  registry: ComponentRegistry;
  /** Lazy manifest load — prop descriptors, design-mode notes per component. */
  loadManifest(): Promise<Manifest>;
  /** Human-readable label, e.g. "shadcn-react 2026.05.22". */
  label?: string;
}

/**
 * Resolve a `Library` config to a concrete provider. Throws
 * `UnknownProviderError` for ids the loader hasn't been wired to handle.
 */
export type ProviderLoader = (library: Library) => Promise<ComponentProvider>;

export class UnknownProviderError extends Error {
  readonly id: string;
  constructor(id: string, message?: string) {
    super(message ?? `Unknown component provider: "${id}"`);
    this.name = "UnknownProviderError";
    this.id = id;
  }
}
