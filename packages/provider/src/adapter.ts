import type { Theme } from "@velloo/schema";
import type { ReactElement } from "react";
import type { ComponentProvider } from "./types.ts";
import type { ComponentDescriptor } from "./manifest.ts";

/**
 * FrameworkAdapter — the grown-up `ComponentProvider`. Where `ComponentProvider` is "a registry +
 * a manifest + where files live", an adapter owns a framework end-to-end: how it's installed, its
 * full component catalog (and which entries are installed), its native styling channel, theme
 * import/emit, the canvas bundle of real installed components, codegen lowering, and scan/import.
 *
 * The migration (see docs/framework-native.md) lands these capabilities phase by phase, so every
 * field beyond the base `ComponentProvider` is OPTIONAL: a plain `ComponentProvider` is a valid
 * (minimal) adapter, and absent capabilities fall back to today's behavior. As each phase lands,
 * the relevant capability moves from "optional, defaulted" to "the adapter supplies it".
 *
 * Reverses the earlier one-embedded-snapshot and Tailwind-everywhere stance.
 */

// --- styling channel (reverses #23: styling is the adapter's, not universally Tailwind) ---

export type StyleChannelKind = "tailwind-classname" | "sx" | "style";

export interface StyleChannel {
  kind: StyleChannelKind;
  /** The node prop that carries this channel's payload (`className` / `sx` / `style`). */
  prop: string;
  /** Whether rendering this channel needs the Tailwind JIT (true only for tailwind-classname). */
  needsTailwindJit: boolean;
  /** Label for the inspector's style editor, e.g. "Tailwind classes" / "sx props". */
  editorLabel: string;
}

/** The default channel — shadcn / no-lib style with Tailwind utility classes on `className`. */
export const TAILWIND_CLASSNAME: StyleChannel = {
  kind: "tailwind-classname",
  prop: "className",
  needsTailwindJit: true,
  editorLabel: "Tailwind classes",
};

/** MUI: the `sx` prop, an emotion style object; no Tailwind JIT. */
export const SX_PROP: StyleChannel = {
  kind: "sx",
  prop: "sx",
  needsTailwindJit: false,
  editorLabel: "sx props",
};

// --- component catalog + installed-status (so the MCP can install on demand) ---

/**
 * How a component reaches the canvas + codegen. `library` = a real installed component;
 * `snippet` = a user composition; `host` = a scanned app component the design agent resolves into
 * a real velloo subtree (Phase 4/5); `div-stub` = a plain element for unsupported frameworks.
 */
export type RenderStrategy = "library" | "snippet" | "host" | "div-stub";

export interface CatalogEntry {
  id: string;
  descriptor: ComponentDescriptor;
  /** false → not present in the project yet; the MCP can offer `install_component`. */
  installed: boolean;
  /** Where codegen imports this component from. */
  importPath: string;
  renderStrategy: RenderStrategy;
}

// --- install / provisioning ---

/** Where a framework's components are installed: the host app, or a velloo-only cache. */
export type InstallTarget = "app" | "velloo";

export interface InstallCtx {
  folderRoot: string;
  hostAppRoot?: string;
  target: InstallTarget;
  /** Major version selected at init (e.g. "6" for MUI v6). */
  majorVersion?: string;
}

export interface InstallResult {
  installed: string[];
  location: string;
  notes?: string;
}

// --- server-side render pass (for frameworks whose styles aren't Tailwind classes) ---

/**
 * A per-render pass an SSR framework supplies (MUI/emotion). `wrap` puts the
 * React tree inside the framework's providers (emotion CacheProvider + MUI
 * ThemeProvider) bound to a fresh per-render cache; `css` returns the critical
 * CSS collected during that render (read after renderToString). Tailwind-class
 * frameworks (shadcn/no-lib) omit this — the renderer's SSR path is unchanged.
 */
export interface RenderPass {
  wrap(element: ReactElement): ReactElement;
  /** Critical CSS for this render — passed the SSR'd body HTML (emotion needs it). */
  css(html: string): string;
}

// --- the adapter ---

export interface FrameworkAdapter extends ComponentProvider {
  /** Native style channel. Absent ⇒ Tailwind className (today's behavior). */
  styleChannel?: StyleChannel;
  /** The library's full catalog with installed-status. Absent ⇒ derive from the manifest. */
  catalog?(): Promise<CatalogEntry[]>;
  /** Install a single catalog entry (per-component for shadcn; no-op when package-level). */
  installComponent?(id: string, ctx: InstallCtx): Promise<void>;
  /** Provision the framework for a folder (npm install / CLI / cache). */
  install?(ctx: InstallCtx): Promise<InstallResult>;
  /** A fresh server-side render pass bound to this theme (emotion/MUI). Absent ⇒ plain SSR. */
  renderPass?(theme: Theme): RenderPass;
  // theme import/emit, canvasBundle, and emit (codegen) land in their phases.
}

/** The active style channel for a provider — defaults to Tailwind className when unspecified. */
export function styleChannelOf(p: ComponentProvider | FrameworkAdapter): StyleChannel {
  return (p as FrameworkAdapter).styleChannel ?? TAILWIND_CLASSNAME;
}
