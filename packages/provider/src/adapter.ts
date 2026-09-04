import type { Theme } from "@velloo/schema";
import type { ReactElement } from "react";
import type { ComponentDescriptor } from "./manifest.ts";
import type { ComponentProvider } from "./types.ts";

/**
 * FrameworkAdapter — the grown-up `ComponentProvider`. Where `ComponentProvider` is "a registry +
 * a manifest + where files live", an adapter owns a framework end-to-end: how it's installed, its
 * full component catalog (and which entries are installed), its native styling channel, theme
 * import/emit, the canvas bundle of real installed components, codegen lowering, and scan/import.
 *
 * Every field beyond the base `ComponentProvider` is OPTIONAL: a plain `ComponentProvider` is a valid
 * (minimal) adapter, and absent capabilities fall back to the default behavior. Where an adapter
 * supplies a capability, it takes over from that default.
 */

// --- styling channel (styling is the adapter's, not universally Tailwind) ---

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

/**
 * No CSS framework: a plain React `style` object (inline styles), rendered
 * with no build step. Theme tokens reach it as CSS variables (`var(--color-…)`,
 * `var(--radius)`) injected by `themeToCss`, so it themes without Tailwind.
 */
export const STYLE_PROP: StyleChannel = {
  kind: "style",
  prop: "style",
  needsTailwindJit: false,
  editorLabel: "Inline styles",
};

/** Every channel by kind, for resolving a folder's CSS-framework choice. */
export const STYLE_CHANNELS: Record<StyleChannelKind, StyleChannel> = {
  "tailwind-classname": TAILWIND_CLASSNAME,
  sx: SX_PROP,
  style: STYLE_PROP,
};

/**
 * The CSS-framework axis, independent of the UI-component framework (the
 * library). `init` detects it from the host app; the folder records it in
 * `config.styling`. `"sx"` is intentionally absent — it's intrinsic to MUI,
 * not a free CSS-framework choice.
 */
export type CssFramework = "tailwind" | "none";

/** Map a folder's chosen CSS framework to the style channel it selects. */
export const CSS_FRAMEWORK_CHANNEL: Record<CssFramework, StyleChannelKind> = {
  tailwind: "tailwind-classname",
  none: "style",
};

// --- component catalog + host-app installed-status ---

export interface CatalogEntry {
  id: string;
  /** false → not present in the host app yet; code emission reports the install plan. */
  installed: boolean;
  /** Where codegen imports this component from. */
  importPath: string;
}

/**
 * Default `catalog()`: derive one `CatalogEntry` per manifest component. The
 * shipped adapters bundle their whole component set, so every entry is
 * `installed: true` from one `importPath` (MUI: `@mui/material`). An adapter
 * whose host components install incrementally (shadcn) overrides this to report
 * real installed-status. Design composition never changes the host app.
 */
export function catalogFromManifest(
  manifest: ComponentDescriptor[],
  opts: { importPath: string; installed?: boolean },
): CatalogEntry[] {
  return manifest.map((descriptor) => ({
    id: descriptor.id,
    installed: opts.installed ?? true,
    importPath: opts.importPath,
  }));
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

// --- native theme artifact (frameworks whose theme isn't Tailwind CSS) ---

/**
 * A value that must serialize as a bare identifier expression in emitted
 * code rather than a JSON value — e.g. Ant Design's `theme.darkAlgorithm`.
 * Produce one with {@link identifierRef}; `ThemeModuleSpec.importLines`
 * must bring the identifier into scope. Codegen's serializer recognizes
 * the shape.
 */
export interface IdentifierRef {
  $identifier: string;
}

/** Wrap an identifier path (e.g. `"theme.darkAlgorithm"`) for native-theme emit. */
export function identifierRef(path: string): IdentifierRef {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(path)) {
    throw new Error(`identifierRef: "${path}" is not a bare identifier path`);
  }
  return { $identifier: path };
}

/**
 * Declares how the native theme artifact is written, paired with
 * `themeToNative`. Codegen's generic `emitNativeTheme` serializes the
 * projected options into a module shaped by this spec — no framework
 * import ever appears outside the provider's own package.
 */
export interface ThemeModuleSpec {
  /** Import lines at the top of the module, e.g. `import { createTheme } from "@mui/material/styles";` */
  importLines: string[];
  /** Factory wrapping the serialized options (`createTheme(...)`); null ⇒ a bare object literal. */
  factory: string | null;
  /** Default artifact path relative to the output dir, e.g. `theme.ts`. */
  defaultPath: string;
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

// --- canvas bundle (#18: render the project's actually-installed components) ---

/**
 * Declares how to bundle this framework's component set from the host app's
 * `node_modules` into a self-contained browser module (`mountScreen`) so the
 * canvas can client-render against the user's exact installed version. Pure
 * data — the server's bundler reads it + the host root and runs `Bun.build`.
 * Absent ⇒ the canvas uses in-process SSR (today's path) only.
 */
/**
 * How the bundled components get their styles at client-mount time. A
 * discriminated union so non-emotion frameworks can join: the adapter declares
 * pure data here, and the server's bundle-entry builder implements each kind
 * (adding a framework with a new runtime = a new union member + a builder
 * branch — see docs/providers.md).
 */
export type CanvasStyleRuntime = {
  kind: "emotion";
  /** emotion cache key prefix (MUI uses `vmui`). */
  cacheKey: string;
  /** Module exporting `ThemeProvider` + `createTheme`, e.g. `@mui/material/styles`. */
  stylesModule: string;
};

export interface CanvasBundleSpec {
  /** Bare module the components import from, e.g. `@mui/material`. */
  moduleBase: string;
  /** Component ids imported as `<moduleBase>/<id>` (default export each). */
  componentIds: string[];
  /** Overlay ids the bundle renders via inline canvas-safe shims (Dialog/Menu/…). */
  overlayIds: string[];
  /** The style runtime the bundle wires up around the mounted tree. */
  styleRuntime: CanvasStyleRuntime;
}

// --- the adapter ---

export interface FrameworkAdapter extends ComponentProvider {
  /**
   * The provider's default/intrinsic style channel. Absent ⇒ Tailwind
   * className. For a single-channel framework (shadcn ⇒ Tailwind, MUI ⇒ sx)
   * this is the only channel; for `none` it's the default when the folder
   * hasn't chosen a CSS framework.
   */
  styleChannel?: StyleChannel;
  /**
   * The CSS frameworks this UI library can pair with, as style-channel kinds
   * (first = default). shadcn ⇒ `["tailwind-classname"]`, MUI ⇒ `["sx"]`,
   * none ⇒ `["tailwind-classname", "style"]`. The folder's `config.styling`
   * choice is honored only if it resolves to a channel in this set; otherwise
   * the default wins (so a shadcn screen stays Tailwind even in a `none`-CSS
   * folder). Absent ⇒ `[styleChannel.kind]`.
   */
  styleChannels?: StyleChannelKind[];
  /**
   * Channel-appropriate runtime registry. A framework whose primitives style
   * differently per channel (`none`: Tailwind-classed vs inline-styled
   * components) returns the right set here; absent ⇒ the static `registry` for
   * every channel. Consumed by `registryForScreen`.
   */
  registryForChannel?(kind: StyleChannelKind): ComponentProvider["registry"];
  /** The library's full catalog with installed-status. Absent ⇒ derive from the manifest. */
  catalog?(): Promise<CatalogEntry[]>;
  /** Provision the framework for a folder (npm install / CLI / cache). */
  install?(ctx: InstallCtx): Promise<InstallResult>;
  /**
   * A fresh server-side render pass bound to this theme (emotion/MUI). Absent ⇒
   * plain SSR. `dark` selects the dark projection of the theme (MUI reads
   * `colorsDark` + `palette.mode`), so a dark-mode capture SSRs dark surfaces
   * rather than light values under a flipped mode flag.
   */
  renderPass?(theme: Theme, dark?: boolean): RenderPass;
  /**
   * The bare module its catalog components import from in emitted code — MUI's
   * `@mui/material`, where every component is a named export. Present ⇒ codegen
   * resolves this library's component ids to `{ Id } from "<codegenModule>"`
   * and skips shadcn lowering. Absent ⇒ shadcn behavior (the `@/components/ui/*`
   * REGISTRY). Per-component import overrides (e.g. icons) come later via
   * `catalog().importPath`.
   */
  codegenModule?: string;
  /**
   * Project velloo's token tree onto this framework's native theme shape — for
   * MUI, the `ThemeOptions` POJO passed to `createTheme`. Returned as `unknown`
   * so the contract doesn't depend on any framework's types; codegen serializes
   * it to the native theme artifact via `emitNativeTheme` + `themeModule`.
   * Values that must emit as identifiers use {@link identifierRef}. Absent ⇒
   * the Tailwind globals.css path.
   */
  themeToNative?(theme: Theme, dark?: boolean): unknown;
  /**
   * The module shape for the native theme artifact `themeToNative` feeds.
   * Required for the native emit path — `emit_theme` uses the Tailwind
   * globals.css path unless BOTH are present.
   */
  themeModule?: ThemeModuleSpec;
  /**
   * Framework framing prepended to the MCP instructions (the rest of the
   * instruction text is shadcn/Tailwind-tuned; this tells the agent what
   * differs). Receives the folder's resolved style channel so multi-channel
   * providers can frame each channel. Absent ⇒ the default shadcn framing.
   */
  mcpIntro?(channel: StyleChannelKind): string[] | undefined;
  /**
   * How to bundle this framework's installed components for the canvas (#18).
   * Present ⇒ the server can build a `mountScreen` bundle from the host's
   * `node_modules` for an exact-installed-version client render; absent ⇒ SSR.
   */
  canvasBundleSpec?: CanvasBundleSpec;
}

/**
 * Resolve a provider's active style channel, honoring the folder's CSS-framework
 * choice when the provider supports it. With no `folderCss`, or when the chosen
 * framework isn't in the provider's allowed set, the provider's default channel
 * wins — so shadcn stays Tailwind and MUI stays `sx` regardless of the folder's
 * CSS choice, while `none` follows it (Tailwind ↔ inline `style`).
 */
export function styleChannelOf(
  p: ComponentProvider | FrameworkAdapter,
  folderCss?: CssFramework,
): StyleChannel {
  const adapter = p as FrameworkAdapter;
  const allowed = adapter.styleChannels ?? [adapter.styleChannel?.kind ?? "tailwind-classname"];
  const fallback = allowed[0] ?? "tailwind-classname";
  if (folderCss) {
    const wanted = CSS_FRAMEWORK_CHANNEL[folderCss];
    if (allowed.includes(wanted)) return STYLE_CHANNELS[wanted];
  }
  return STYLE_CHANNELS[fallback];
}
