/**
 * Which props a plain HTML element can carry in emitted JSX.
 *
 * A velloo primitive lowered to plain HTML (`Text` ⇒ `<p>`, `Stack` ⇒ `<div>`)
 * would otherwise print every prop its node holds — and agents reach for other
 * libraries' props on them (Mantine's `fw`, `maw`, `c`), which the canvas
 * renders as inert attributes and React rejects as invalid DOM props. Only a
 * React DOM prop the element actually takes survives the lowering.
 */

import { SVG_ELEMENT_NAMES } from "@velloo/schema/svg-sanitize";

/** React's names for the attributes every HTML element takes. */
const GLOBAL = new Set([
  "id",
  "title",
  "role",
  "style",
  "lang",
  "dir",
  "hidden",
  "tabIndex",
  "accessKey",
  "contentEditable",
  "draggable",
  "spellCheck",
  "translate",
  "inputMode",
  "enterKeyHint",
  "autoCapitalize",
  "autoFocus",
  "inert",
  "popover",
  "slot",
  "itemProp",
  "itemScope",
  "itemType",
  "itemID",
  "itemRef",
]);

const FORM_CONTROL = ["name", "disabled", "form", "autoComplete", "required"];
const MEDIA = [
  "src",
  "autoPlay",
  "controls",
  "loop",
  "muted",
  "preload",
  "crossOrigin",
  "playsInline",
];

/** The element-specific attributes, by tag. A tag not listed takes the global set only. */
const BY_TAG: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    a: ["href", "target", "rel", "download", "hrefLang", "type", "referrerPolicy", "ping"],
    area: ["href", "target", "rel", "download", "alt", "coords", "shape"],
    audio: MEDIA,
    blockquote: ["cite"],
    button: [
      ...FORM_CONTROL,
      "type",
      "value",
      "formAction",
      "formMethod",
      "formNoValidate",
      "formTarget",
      "popoverTarget",
      "popoverTargetAction",
    ],
    canvas: ["width", "height"],
    col: ["span"],
    colgroup: ["span"],
    data: ["value"],
    del: ["cite", "dateTime"],
    details: ["open", "name"],
    dialog: ["open"],
    fieldset: ["disabled", "name", "form"],
    form: ["action", "method", "encType", "noValidate", "target", "name", "autoComplete", "rel"],
    iframe: [
      "src",
      "srcDoc",
      "name",
      "width",
      "height",
      "allow",
      "allowFullScreen",
      "loading",
      "referrerPolicy",
      "sandbox",
    ],
    img: [
      "src",
      "srcSet",
      "sizes",
      "alt",
      "width",
      "height",
      "loading",
      "decoding",
      "crossOrigin",
      "referrerPolicy",
      "fetchPriority",
      "useMap",
    ],
    input: [
      ...FORM_CONTROL,
      "type",
      "value",
      "defaultValue",
      "checked",
      "defaultChecked",
      "placeholder",
      "readOnly",
      "min",
      "max",
      "step",
      "minLength",
      "maxLength",
      "pattern",
      "size",
      "list",
      "multiple",
      "accept",
      "alt",
      "src",
      "width",
      "height",
    ],
    ins: ["cite", "dateTime"],
    label: ["htmlFor", "form"],
    li: ["value"],
    meter: ["value", "min", "max", "low", "high", "optimum"],
    ol: ["start", "reversed", "type"],
    optgroup: ["label", "disabled"],
    option: ["value", "label", "selected", "disabled"],
    output: ["htmlFor", "name", "form"],
    progress: ["value", "max"],
    q: ["cite"],
    select: [...FORM_CONTROL, "value", "defaultValue", "multiple", "size"],
    source: ["src", "srcSet", "sizes", "type", "media", "width", "height"],
    td: ["colSpan", "rowSpan", "headers"],
    textarea: [
      ...FORM_CONTROL,
      "value",
      "defaultValue",
      "placeholder",
      "readOnly",
      "rows",
      "cols",
      "minLength",
      "maxLength",
      "wrap",
    ],
    th: ["colSpan", "rowSpan", "headers", "scope", "abbr"],
    time: ["dateTime"],
    track: ["src", "kind", "label", "srcLang", "default"],
    video: [...MEDIA, "poster", "width", "height"],
  }).map(([tag, names]) => [tag, new Set(names)]),
);

/** SVG's own elements; the three it shares with HTML keep HTML's attributes. */
const SVG_TAGS = new Set(
  [...SVG_ELEMENT_NAMES].filter((name) => !["a", "style", "title"].includes(name)),
);

/** Whether `<tag>` takes `prop` in React's DOM. */
export function isDomProp(tag: string, prop: string): boolean {
  if (/^(?:data|aria)-[\w-]+$/.test(prop)) return true;
  // SVG has presentation attributes by the hundred, and a shape emitted
  // without its `d`, `fill` or `offset` draws nothing. Hold it to what the
  // sanitizer holds SVG markup to: anything but a handler.
  if (SVG_TAGS.has(tag)) return /^[A-Za-z][\w:.-]*$/.test(prop) && !/^on[A-Z]/.test(prop);
  return GLOBAL.has(prop) || (Object.hasOwn(BY_TAG, tag) && BY_TAG[tag]?.has(prop) === true);
}
