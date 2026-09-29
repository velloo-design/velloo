/**
 * The HTML/htmx components and their sanitizer, free of Node APIs: the canvas
 * renders them server-side, and the cloud share viewer imports this module in
 * the browser to render a published HTML design. A published tree is
 * untrusted input there, so every guarantee below holds at render time, not
 * only when a design is written.
 */
import type { ComponentRegistry } from "@velloo/provider";
import { inlineRegistry } from "@velloo/provider-none/registry-inline";
import { styleObjectFromCss } from "@velloo/schema";
import { createElement, type HTMLAttributes, type ReactNode } from "react";

// Keep executable/embedded tags out of editable designs while accepting the
// ordinary semantic elements and static SVG shapes found in native templates.
const SAFE_TAG =
  /^(?:a|abbr|address|article|aside|b|bdi|bdo|blockquote|br|button|caption|circle|cite|clipPath|code|col|colgroup|data|dd|defs|del|details|dfn|div|dl|dt|ellipse|em|fieldset|figcaption|figure|footer|form|g|h[1-6]|header|hr|i|img|input|ins|kbd|label|legend|li|line|linearGradient|main|mark|mask|meter|nav|ol|optgroup|option|output|p|path|picture|polygon|polyline|pre|progress|q|radialGradient|rect|s|samp|section|select|small|source|span|stop|strong|sub|summary|sup|svg|table|tbody|td|text|textarea|tfoot|th|thead|time|tr|tspan|u|ul|var|wbr)$/;

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

/** Whether `Html` renders this tag: semantic HTML and static SVG, nothing that runs or embeds. */
export function isSafeTag(tag: string): boolean {
  return SAFE_TAG.test(tag);
}

/**
 * Whether an attribute may carry this value: never an event handler or raw
 * inner HTML, and never a URL that runs script.
 */
export function safeAttributeValue(name: string, value: unknown): boolean {
  const key = name.toLowerCase();
  if (key.startsWith("on") || key === "dangerouslysetinnerhtml") return false;
  if (URL_ATTRIBUTES.has(key) && typeof value === "string") {
    return !SCRIPT_URL.test(withoutControls(value));
  }
  return true;
}

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
      .filter(([name, value]) => safeAttributeValue(name, value))
      .flatMap(([name, value]) => {
        // HTML's own `style="…"` (a snapshot of server output, or a design
        // written as markup) is text; React only takes an object.
        if (name !== "style" || typeof value !== "string") return [[name, value] as const];
        const style = styleObjectFromCss(value);
        return style ? [[name, style] as const] : [];
      }),
  );
}

export function Html({
  as = "div",
  children,
  // Where a design snapshot came from: the design's bookkeeping, not markup.
  snapshotOf: _source,
  snapshotSelect: _select,
  ...props
}: HtmlProps & { snapshotOf?: unknown; snapshotSelect?: unknown }) {
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

/** The inline-style primitives and helpers, plus the native HTML components. */
export const registry: ComponentRegistry = { ...inlineRegistry, Html, HtmlFragment };
