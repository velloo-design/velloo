import {
  type ComponentDescriptor,
  type FrameworkAdapter,
  type Manifest,
  STYLE_PROP,
} from "@velloo/provider";
import { componentsDir, entryCssPath, NONE_MANIFEST } from "@velloo/provider-none";
import { registry } from "./registry.ts";
import { HTML_VERSION } from "./version.ts";

export { Html, isSafeTag, safeAttributeValue } from "./registry.ts";

const htmlDescriptors: ComponentDescriptor[] = [
  {
    id: "Html",
    category: "ui",
    source: "velloo",
    group: "layout",
    family: "Html",
    allowUnknownProps: true,
    designModeNotes:
      "Use for a native HTML element. Set as to a semantic tag and pass ordinary HTML or hx-* attributes as props.",
    props: [
      { name: "as", type: "string", optional: true, control: "string", defaultValue: "div" },
      { name: "className", type: "string", optional: true, control: "string" },
      { name: "style", type: "CSSProperties", optional: true, control: "string" },
      { name: "children", type: "ReactNode", optional: true, control: "string" },
    ],
  },
];

const HTML_MANIFEST: Manifest = [...NONE_MANIFEST, ...htmlDescriptors];

const HTML_INTRO = [
  'This is an HTML/htmx app. Compose semantic HTML with Html as="form" or other tags and give forms and controls the hx-* attributes the implementation needs. The canvas never runs them or contacts the app: a design is a fixed picture, the same for everyone who opens it. emit_code keeps them and returns native HTML for the app\'s templates.',
  "To reproduce an existing page, capture it with start_capture_session (the running app, signed in if needed) and rebuild it from get_capture as Html nodes. Put the data the design should show into the nodes themselves.",
  "This provider does not supply Tailwind. Use the host app's CSS classes or inline style props; when adding new classes, author their CSS in the app. The app's stylesheets style the design through the copies the design keeps: store_host_files refreshes them from the app's source or from a capture. Theme tokens are CSS variables (var(--color-primary)); emit_theme writes the stylesheet that defines them for the app.",
  "Reference the app's own files by their real paths (src=\"/static/logo.png\", url(/static/hero.jpg)): the canvas shows the design's stored copy (store_host_files keeps the ones the design names), and emit_code keeps the paths as written. Don't import host files as Velloo assets.",
  "On a form, a custom hx-trigger replaces htmx's default submit trigger. Include submit when a submit button must swap a response instead of navigating the page.",
];

/**
 * The HTML/htmx adapter: the no-library primitives and helpers on the inline
 * `style` channel, plus `Html`, styled by the app's own stylesheets. No browser
 * component bundle — the server render is the page — and emission is native
 * HTML, not JSX.
 */
export function createProvider(): FrameworkAdapter {
  return {
    id: "html",
    version: HTML_VERSION,
    label: "HTML + htmx",
    componentsDir,
    styleEntryPath: entryCssPath,
    registry,
    loadManifest: async () => HTML_MANIFEST,
    styleChannel: STYLE_PROP,
    styleChannels: ["style"],
    registryForChannel: () => registry,
    mcpIntro: () => HTML_INTRO,
    hostStylesheets: true,
    codegenFormat: "html",
    elementComponent: "Html",
  };
}
