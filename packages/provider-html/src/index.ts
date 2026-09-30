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
  "**This is a server-rendered HTML/htmx app.** Compose semantic HTML with `Html` nodes (`as=\"form\"`, …), styled by the app's own CSS classes or inline `style` — there is no Tailwind; new classes need CSS authored in the app. Give forms and controls the real `hx-*` attributes: the canvas never fires them, and `emit_code` keeps them in the native HTML it returns for the app's templates.",
  "",
  "A design never contacts the running app: it is styled by copies of the app's stylesheets, which `store_host_files` refreshes from source or from a capture (including built CSS a `screenshot` reports missing). Reference the app's files by their real paths (`src=\"/static/logo.png\"`), not as Velloo assets. Theme tokens are CSS variables (`var(--color-primary)`); `emit_theme` writes the stylesheet that defines them.",
  "",
  "To reproduce a page, capture it from the running app with `start_capture_session` (the user signs in if needed), rebuild it from `get_capture` with the content written into the nodes, and verify with `compare_to_url { captureId }`.",
  "",
  "On a form, a custom `hx-trigger` replaces htmx's default submit trigger — include `submit` when a submit button must swap a response instead of navigating.",
  "",
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
