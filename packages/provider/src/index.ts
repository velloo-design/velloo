export {
  type CanvasBundleSpec,
  type CanvasComponentFidelity,
  type CanvasComponentSource,
  type CanvasComponentSpec,
  type CanvasStyleRuntime,
  type CatalogEntry,
  CSS_FRAMEWORK_CHANNEL,
  type CssFramework,
  catalogFromManifest,
  type FrameworkAdapter,
  type IdentifierRef,
  type InstallCtx,
  type InstallResult,
  type InstallTarget,
  identifierRef,
  type RenderPass,
  STYLE_CHANNELS,
  STYLE_PROP,
  type StyleChannel,
  type StyleChannelKind,
  SX_PROP,
  styleChannelOf,
  TAILWIND_CLASSNAME,
  type ThemeModuleSpec,
} from "./adapter.ts";
export {
  createProviderLoader,
  type ProviderFactory,
} from "./loader.ts";
export {
  COMPONENT_GROUPS,
  type ComponentDescriptor,
  type ComponentGroup,
  type ControlType,
  groupLabel,
  type Manifest,
  type PropDescriptor,
  UNGROUPED_LABEL,
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
