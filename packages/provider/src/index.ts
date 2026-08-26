export {
  type CanvasBundleSpec,
  type CatalogEntry,
  CSS_FRAMEWORK_CHANNEL,
  type CssFramework,
  catalogFromManifest,
  type FrameworkAdapter,
  type InstallCtx,
  type InstallResult,
  type InstallTarget,
  type RenderPass,
  type RenderStrategy,
  STYLE_CHANNELS,
  STYLE_PROP,
  type StyleChannel,
  type StyleChannelKind,
  SX_PROP,
  styleChannelOf,
  TAILWIND_CLASSNAME,
} from "./adapter.ts";
export {
  createProviderLoader,
  type ProviderFactory,
} from "./loader.ts";
export type {
  ComponentDescriptor,
  ControlType,
  Manifest,
  PropDescriptor,
} from "./manifest.ts";
// NOTE: resolveProviderSrcDir intentionally does NOT re-export here — it
// touches node:fs/node:path, and this index must stay browser-safe (the
// velloo-cloud share viewer imports it via the ext registry). Node-side
// consumers import it from "@velloo/provider/src-dir".
export {
  type ComponentProvider,
  type ComponentRegistry,
  type ProviderLoader,
  UnknownProviderError,
} from "./types.ts";
