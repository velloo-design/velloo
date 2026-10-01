import type { Theme } from "@velloo/schema";
import type { ThemeModuleSpec } from "./adapter.ts";
import type { ComponentGroup } from "./manifest.ts";

/**
 * A framework recipe: what a popular library needs so its components render
 * well through the repository-component path — without a provider package,
 * a schema library id, or a hand-curated catalog (discovery supplies that).
 * It is the built-in form of what the setup agent writes for a custom system:
 * a preview entry, a theme mapping, overlay adaptations, the style channels its
 * components accept, and notes for agents.
 *
 * The contract lives here, next to `FrameworkAdapter`, because the two are the
 * public tiers a new library can arrive through — and a recipe needs no schema
 * library id, no loader row and no wizard entry, so the whole of one is a single
 * file. Selecting a recipe needs the host app's `node_modules`, so the registry
 * that does it stays Node-side (`packages/server/src/repo/recipes/`); nothing
 * here touches the filesystem.
 */
export interface FrameworkRecipe {
  id: string;
  label: string;
  /** npm packages whose components this recipe speaks for. */
  packages: string[];
  /**
   * Source of the default preview entry, used when the app has written none.
   * `resolve` maps a bare specifier to the host app's installed file, so the
   * generated module (which lives in a temp dir) links the app's own copy.
   * Returns null when the host lacks what the wrapper needs.
   */
  previewModule(resolve: (specifier: string) => string | null): string | null;
  /** Velloo tokens → the framework's theme input, handed to the preview entry. */
  themeToNative(theme: Theme, dark: boolean): unknown;
  /** How `emit_theme` writes that native theme as a module. */
  themeModule: ThemeModuleSpec;
  /**
   * Design-time props merged under the authored ones (never emitted), keyed by
   * `Export` or `Export.Member` — e.g. keep an overlay inside the frame.
   */
  adaptations: Record<string, { props: Record<string, unknown>; note: string }>;
  /** Per-instance style props the library's components accept. */
  styleProps: string[];
  /**
   * A DOM probe that only matches when the library's stylesheet is loaded: a
   * component that renders without it is reported `unstyled`, never exact.
   */
  stylesheetProbe?: {
    html: string;
    selector: string;
    property: string;
    expect: string;
    stylesheet: string;
  };
  /** Browsing shelves for families the name heuristics would misfile. */
  groups?: Record<string, ComponentGroup>;
  /** Framing for agents working in a folder that uses this library. */
  notes: string[];
}
