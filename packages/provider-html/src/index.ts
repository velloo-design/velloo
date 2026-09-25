import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentDescriptor, ComponentRegistry, FrameworkAdapter } from "@velloo/provider";
import { createProvider as createNoneProvider, NONE_MANIFEST } from "@velloo/provider-none";
import { renderBody } from "@velloo/renderer";
import type { Screen, Snippet } from "@velloo/schema";
import { createElement, type HTMLAttributes, type ReactNode } from "react";
import { HTML_VERSION } from "./version.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const htmxFilePath =
  [join(here, "htmx.min.js"), join(here, "pkgs/provider-html/src/htmx.min.js")].find((path) =>
    existsSync(path),
  ) ?? join(here, "htmx.min.js");

// Keep executable/embedded tags out of editable designs while accepting the
// ordinary semantic elements and static SVG shapes found in native templates.
const SAFE_TAG =
  /^(?:a|abbr|address|article|aside|b|bdi|bdo|blockquote|br|button|caption|circle|cite|code|col|colgroup|data|dd|defs|del|details|dfn|div|dl|dt|ellipse|em|fieldset|figcaption|figure|footer|form|g|h[1-6]|header|hr|i|img|input|ins|kbd|label|legend|li|line|main|mark|meter|nav|ol|optgroup|option|output|p|path|polygon|polyline|pre|progress|q|rect|s|samp|section|select|small|span|stop|strong|sub|summary|sup|svg|table|tbody|td|text|textarea|tfoot|th|thead|time|tr|u|ul|var|wbr)$/;

type HtmlProps = HTMLAttributes<HTMLElement> & {
  as?: string;
  children?: ReactNode;
  [key: string]: unknown;
};

export function Html({ as = "div", children, ...props }: HtmlProps) {
  if (!SAFE_TAG.test(as)) throw new Error(`Html: unsupported HTML tag ${JSON.stringify(as)}`);
  const clean = Object.fromEntries(Object.entries(props).filter(([name]) => !/^on/i.test(name)));
  return createElement(as, clean, children);
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
  if (!SAFE_TAG.test(as))
    throw new Error(`HtmlFragment: unsupported HTML tag ${JSON.stringify(as)}`);
  if (select && as !== "div") throw new Error("HtmlFragment select currently requires as=div");
  const clean = Object.fromEntries(Object.entries(props).filter(([name]) => !/^on/i.test(name)));
  // hx-select is inherited by htmx descendants. Keep it on a one-shot loader
  // so a nested search or form can swap its own response without selecting
  // from that response again.
  if (select) {
    return createElement(
      "div",
      {
        ...clean,
        "data-velloo-html-fragment": "",
        "data-velloo-host-path": src,
        ...(boost ? { "hx-boost": "true" } : {}),
      },
      createElement(
        "div",
        { "hx-get": src, "hx-trigger": "load", "hx-swap": "outerHTML", "hx-select": select },
        children,
      ),
    );
  }
  return createElement(
    as,
    {
      ...clean,
      "hx-get": src,
      "hx-trigger": "load",
      "hx-swap": "innerHTML",
      "data-velloo-html-fragment": "",
      "data-velloo-host-path": src,
      ...(boost ? { "hx-boost": "true" } : {}),
    },
    children,
  );
}

/** Native HTML for an app template, without Velloo's canvas bookkeeping. */
export function emitNativeHtml(
  screen: Screen,
  registry: ComponentRegistry,
  snippets?: Map<string, Snippet>,
): string {
  return renderBody(screen, registry, snippets).replace(
    /\sdata-(?:node-path|snippet-id|snippet-path|velloo-html-fragment|velloo-host-path)="[^"]*"/g,
    "",
  );
}

const htmlDescriptors: ComponentDescriptor[] = [
  {
    id: "Html",
    category: "ui",
    source: "velloo",
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

export function createProvider(): FrameworkAdapter {
  const base = createNoneProvider();
  const { canvasBundleSpec: _browserMount, ...serverOnly } = base;
  return {
    ...serverOnly,
    id: "html",
    version: HTML_VERSION,
    label: "HTML + htmx",
    registry: { ...base.registry, Html, HtmlFragment },
    registryForChannel: (kind) => ({
      ...(base.registryForChannel?.(kind) ?? base.registry),
      Html,
      HtmlFragment,
    }),
    loadManifest: async () => [...NONE_MANIFEST, ...htmlDescriptors],
    mcpIntro: () => [
      'This is an HTML/htmx app. Compose semantic HTML with Html as="form" or other tags and use hx-* attributes for server interactions.',
      'HtmlFragment src="/route" previews a real server-rendered fragment from the configured host URL. Set as="tbody" for table rows, or another semantic container that is valid in its parent. emit_code returns native HTML for the app\'s templates.',
      "This provider does not supply Tailwind. Use the host app's CSS classes or inline style props; when adding new classes, author their CSS in the app. Native emitted HTML keeps those classes and styles.",
      "On a form, a custom hx-trigger replaces htmx's default submit trigger. Include submit when a submit button must swap a response instead of navigating the page.",
    ],
  };
}
