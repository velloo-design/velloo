import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ComponentDescriptor,
  type FrameworkAdapter,
  type Manifest,
  STYLE_PROP,
} from "@velloo/provider";
import { resolveProviderSrcDir } from "@velloo/provider/src-dir";
import {
  componentsDir,
  entryCssPath,
  NONE_MANIFEST,
  createProvider as noneProvider,
} from "@velloo/provider-none";
import { createElement, type HTMLAttributes, type ReactNode } from "react";
import { HTML_VERSION } from "./version.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored htmx 2 runtime (0BSD, see HTMX-LICENSE), from source or the bundled CLI. */
const htmxScriptPath = join(
  resolveProviderSrcDir(here, "provider-html", undefined, "htmx.min.js"),
  "htmx.min.js",
);

// Keep executable/embedded tags out of editable designs while accepting the
// ordinary semantic elements and static SVG shapes found in native templates.
const SAFE_TAG =
  /^(?:a|abbr|address|article|aside|b|bdi|bdo|blockquote|br|button|caption|circle|cite|code|col|colgroup|data|dd|defs|del|details|dfn|div|dl|dt|ellipse|em|fieldset|figcaption|figure|footer|form|g|h[1-6]|header|hr|i|img|input|ins|kbd|label|legend|li|line|main|mark|meter|nav|ol|optgroup|option|output|p|path|polygon|polyline|pre|progress|q|rect|s|samp|section|select|small|span|stop|strong|sub|summary|sup|svg|table|tbody|td|text|textarea|tfoot|th|thead|time|tr|u|ul|var|wbr)$/;

/** Attributes whose value the browser loads or navigates to. */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "xlinkhref",
  "xlink:href",
]);
// Browsers ignore ASCII whitespace and control characters inside a scheme, so
// `java\tscript:` must be caught too.
const SCRIPT_URL = /^(?:javascript|vbscript):|^data:text\/html/i;

const withoutControls = (value: string): string =>
  [...value].filter((char) => char.charCodeAt(0) > 0x20).join("");

/**
 * HTML attribute names an agent writing markup reaches for, as the React props
 * that render them — React renders `autocomplete` too, but warns on every
 * render and drops `class`'s meaning for its own `className` handling.
 */
const REACT_PROP: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  enctype: "encType",
  novalidate: "noValidate",
  datetime: "dateTime",
  srcset: "srcSet",
  crossorigin: "crossOrigin",
  accesskey: "accessKey",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  formaction: "formAction",
  formmethod: "formMethod",
  inputmode: "inputMode",
  referrerpolicy: "referrerPolicy",
};

type HtmlProps = HTMLAttributes<HTMLElement> & {
  as?: string;
  children?: ReactNode;
  [key: string]: unknown;
};

function safeTag(component: string, as: string): string {
  if (!SAFE_TAG.test(as))
    throw new Error(`${component}: unsupported HTML tag ${JSON.stringify(as)}`);
  return as;
}

/**
 * Props a design may put on a native element: never event handlers, raw inner
 * HTML, or a URL that runs script — the canvas executes the document, so an
 * attribute is as dangerous as a `<script>` tag.
 */
function nativeAttributes(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props)
      .map(([name, value]) => [REACT_PROP[name] ?? name, value] as const)
      .filter(([name, value]) => {
        const key = name.toLowerCase();
        if (key.startsWith("on") || key === "dangerouslysetinnerhtml") return false;
        if (URL_ATTRIBUTES.has(key) && typeof value === "string") {
          return !SCRIPT_URL.test(withoutControls(value));
        }
        return true;
      }),
  );
}

export function Html({ as = "div", children, ...props }: HtmlProps) {
  return createElement(safeTag("Html", as), nativeAttributes(props), children);
}

export function HtmlFragment({
  src,
  select,
  boost = true,
  as = "div",
  children,
  ...props
}: HtmlProps & { src: string; select?: string; boost?: boolean }) {
  if (!src.startsWith("/") || src.startsWith("//")) {
    throw new Error("HtmlFragment src must be a root-relative host route");
  }
  const tag = safeTag("HtmlFragment", as);
  if (select && tag !== "div") throw new Error("HtmlFragment select currently requires as=div");
  // The host runtime resolves requests from inside a fragment against the
  // route it currently shows (these markers); native emission strips them.
  const own = {
    ...nativeAttributes(props),
    "data-velloo-html-fragment": "",
    "data-velloo-host-path": src,
    ...(boost ? { "hx-boost": "true" } : {}),
  };
  // hx-select is inherited by htmx descendants. Keep it on a one-shot loader
  // so a nested search or form can swap its own response without selecting
  // from that response again.
  if (select) {
    return createElement(
      "div",
      own,
      createElement(
        "div",
        { "hx-get": src, "hx-trigger": "load", "hx-swap": "outerHTML", "hx-select": select },
        children,
      ),
    );
  }
  return createElement(
    tag,
    { ...own, "hx-get": src, "hx-trigger": "load", "hx-swap": "innerHTML" },
    children,
  );
}

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
  const inline = noneProvider().registryForChannel?.("style");
  if (!inline) throw new Error("provider-none lost its inline-style registry");
  const registry = { ...inline, Html, HtmlFragment };
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
    codegenFormat: "html",
  };
}
