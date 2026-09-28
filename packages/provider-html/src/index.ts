import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ComponentDescriptor,
  type FrameworkAdapter,
  type Manifest,
  STYLE_PROP,
} from "@velloo/provider";
import { resolveProviderSrcDir } from "@velloo/provider/src-dir";
import { componentsDir, entryCssPath, NONE_MANIFEST } from "@velloo/provider-none";
import { registry } from "./registry.ts";
import { staticSnapshot } from "./snapshot.ts";
import { HTML_VERSION } from "./version.ts";

export { Html, HtmlFragment, isSafeTag, safeAttributeValue } from "./registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored htmx 2 runtime (0BSD, see HTMX-LICENSE), from source or the bundled CLI. */
const htmxScriptPath = join(
  resolveProviderSrcDir(here, "provider-html", undefined, "htmx.min.js"),
  "htmx.min.js",
);

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
  {
    id: "HtmlFragment",
    category: "ui",
    source: "velloo",
    group: "display",
    family: "HtmlFragment",
    allowUnknownProps: true,
    designModeNotes:
      "Load a real server-rendered HTML fragment from the running host app. src is a root-relative GET route; its own hx-* controls remain interactive in preview.",
    props: [
      { name: "src", type: "string", optional: false, control: "string" },
      { name: "as", type: "string", optional: true, control: "string", defaultValue: "div" },
      { name: "select", type: "string", optional: true, control: "string" },
      { name: "boost", type: "boolean", optional: true, control: "boolean" },
      { name: "className", type: "string", optional: true, control: "string" },
      { name: "style", type: "CSSProperties", optional: true, control: "string" },
    ],
  },
];

const HTML_MANIFEST: Manifest = [...NONE_MANIFEST, ...htmlDescriptors];

const HTML_INTRO = [
  'This is an HTML/htmx app. Compose semantic HTML with Html as="form" or other tags and use hx-* attributes for server interactions.',
  'HtmlFragment src="/route" previews a real server-rendered fragment from the configured host URL. Set as="tbody" for table rows, or another semantic container that is valid in its parent. emit_code returns native HTML for the app\'s templates.',
  "This provider does not supply Tailwind. Use the host app's CSS classes or inline style props; when adding new classes, author their CSS in the app. Theme tokens are CSS variables (var(--color-primary)); emit_theme writes the stylesheet that defines them for the app.",
  "Reference the app's own files by their real paths (src=\"/static/logo.png\", url(/static/hero.jpg)): the canvas loads root-relative URLs from the running app, and emit_code keeps them as written. Don't import host files as Velloo assets.",
  "On a form, a custom hx-trigger replaces htmx's default submit trigger. Include submit when a submit button must swap a response instead of navigating the page.",
];

/**
 * The HTML/htmx adapter: the no-library primitives and helpers on the inline
 * `style` channel, plus `Html` / `HtmlFragment`. No browser component bundle —
 * the server render is the page — and emission is native HTML, not JSX.
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
    hostRuntime: { kind: "htmx", scriptPath: htmxScriptPath },
    staticSnapshot,
    codegenFormat: "html",
    elementComponent: "Html",
  };
}
