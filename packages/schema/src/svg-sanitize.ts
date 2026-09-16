/**
 * Active-content sanitization for SVG markup. SVG that ends up inlined via
 * `dangerouslySetInnerHTML` (the `<SVG content>` helper), emitted into a
 * consumer app by codegen, or written to a design folder's `assets/` store is
 * untrusted (a design-JSON author or a hosted generator authored it). This
 * module is the single source of that logic — the render boundary
 * (`@velloo/helpers`' SVG component), codegen emit, the asset store and publish
 * all route through it so no path inlines unsanitized SVG.
 *
 * It tokenizes the markup the way an HTML parser reads it, keeps only static
 * SVG elements and attributes, and re-serializes with every value escaped. The
 * browser therefore parses exactly the tree that was checked: an
 * entity-encoded `&#106;avascript:` is decoded before the URL check, and a `<`
 * that was never a kept tag can only come back out as `&lt;`. Pattern-matching
 * the raw string can't offer that, because entities, tabs and parser recovery
 * rewrite what the browser ends up seeing.
 */

const ALLOWED_ELEMENTS: ReadonlyMap<string, string> = new Map(
  [
    "a",
    "circle",
    "clipPath",
    "defs",
    "desc",
    "ellipse",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "filter",
    "g",
    "image",
    "line",
    "linearGradient",
    "marker",
    "mask",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "stop",
    "style",
    "svg",
    "switch",
    "symbol",
    "text",
    "textPath",
    "title",
    "tspan",
    "use",
    "view",
  ].map((name) => [name.toLowerCase(), name]),
);

/**
 * Elements whose presence means the input tried to run or load something.
 * They are dropped like any unknown element; naming them is what lets
 * `svgLooksActive` tell hostile input from an editor's harmless `<metadata>`.
 */
const ACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  "animate",
  "animatecolor",
  "animatemotion",
  "animatetransform",
  "applet",
  "audio",
  "base",
  "embed",
  "foreignobject",
  "form",
  "frame",
  "frameset",
  "iframe",
  "img",
  "input",
  "link",
  "meta",
  "noscript",
  "object",
  "script",
  "set",
  "template",
  "video",
]);

/** HTML raw-text elements: their content is not markup, so skip it by end tag. */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "xmp",
]);

/** HTML void elements: they never have content, with or without a closing slash. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  colon: ":",
  copy: "©",
  deg: "°",
  divide: "÷",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  NewLine: "\n",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  sol: "/",
  Tab: "\t",
  times: "×",
  trade: "™",
};

const ATTRIBUTE_NAME = /^[A-Za-z_][-A-Za-z0-9_.:]*$/;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

interface SanitizeResult {
  markup: string;
  /** True when something executable or externally loading was removed. */
  removedActive: boolean;
}

/** True when `markup` contains executing-capable SVG (script/handlers/URLs/SMIL). */
export function svgLooksActive(markup: string): boolean {
  return sanitize(markup).removedActive;
}

/**
 * Strip active content from SVG markup, leaving the static drawing intact:
 * only known SVG elements survive, `on*` handlers are dropped, links must be
 * fragments, relative, http(s), mailto or raster `data:` images, and CSS may
 * not import or fetch anything but in-document `url(#id)` references.
 */
export function sanitizeSvgMarkup(markup: string): string {
  return sanitize(markup).markup;
}

interface OpenElement {
  /** Canonical SVG name, or null for an element dropped along with its children. */
  name: string | null;
  lower: string;
}

function sanitize(input: string): SanitizeResult {
  const lower = input.toLowerCase();
  const out: string[] = [];
  const stack: OpenElement[] = [];
  let removedActive = false;
  /** How many dropped elements enclose the cursor; their content is discarded. */
  let dropped = 0;
  let i = 0;

  const emitText = (text: string) => {
    if (dropped === 0 && text !== "") out.push(escapeText(decodeEntities(text)));
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      emitText(input.slice(i));
      break;
    }
    emitText(input.slice(i, lt));
    i = lt;

    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      const stop = end === -1 ? input.length : end;
      if (dropped === 0) out.push(escapeText(input.slice(i + 9, stop)));
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    const next = input[i + 1] ?? "";
    if (next === "!" || next === "?") {
      // A DOCTYPE's internal subset (`[<!ENTITY …>]`) contains `>` of its own.
      const gt = input.indexOf(">", i + 2);
      const bracket = lower.startsWith("<!doctype", i) ? input.indexOf("[", i) : -1;
      const subsetEnd =
        bracket !== -1 && (gt === -1 || bracket < gt) ? input.indexOf("]", bracket) : -1;
      const end = input.indexOf(">", subsetEnd === -1 ? i + 2 : subsetEnd);
      i = end === -1 ? input.length : end + 1;
      continue;
    }
    if (next === "/" && isNameStart(input[i + 2] ?? "")) {
      const end = input.indexOf(">", i + 2);
      const raw = input.slice(i + 2, end === -1 ? input.length : end);
      i = end === -1 ? input.length : end + 1;
      closeElement(tagName(raw).toLowerCase());
      continue;
    }
    if (!isNameStart(next)) {
      emitText("<");
      i += 1;
      continue;
    }

    const tag = readStartTag(input, i + 1);
    i = tag.end;
    const tagLower = tag.name.toLowerCase();
    const localName = tagLower.slice(tagLower.lastIndexOf(":") + 1);
    const canonical = tagLower.includes(":") ? undefined : ALLOWED_ELEMENTS.get(tagLower);

    const report = (active: boolean) => {
      if (active) removedActive = true;
    };

    if (RAW_TEXT_ELEMENTS.has(tagLower) && !tag.selfClosing) {
      const close = lower.indexOf(`</${tagLower}`, i);
      const content = input.slice(i, close === -1 ? input.length : close);
      const gt = close === -1 ? -1 : input.indexOf(">", close);
      i = gt === -1 ? input.length : gt + 1;
      if (dropped > 0) continue;
      if (canonical === "style") {
        const css = filterCss(content.replace(/<!\[CDATA\[|\]\]>/g, ""));
        report(css.removed);
        out.push(`<style${serializeAttributes(tag.attributes, report)}>`);
        out.push(escapeText(css.value), "</style>");
      } else {
        report(ACTIVE_ELEMENTS.has(localName));
      }
      continue;
    }

    if (dropped > 0 || !canonical) {
      if (dropped === 0) report(ACTIVE_ELEMENTS.has(localName));
      if (!tag.selfClosing && !VOID_ELEMENTS.has(tagLower)) {
        stack.push({ name: null, lower: tagLower });
        dropped += 1;
      }
      continue;
    }

    const attributes = serializeAttributes(tag.attributes, report);
    if (tag.selfClosing) {
      out.push(`<${canonical}${attributes}/>`);
    } else {
      out.push(`<${canonical}${attributes}>`);
      stack.push({ name: canonical, lower: tagLower });
    }
  }

  while (stack.length > 0) popElement();
  return { markup: out.join(""), removedActive };

  function closeElement(name: string) {
    let index = stack.length - 1;
    while (index >= 0 && stack[index]?.lower !== name) index -= 1;
    if (index === -1) return;
    while (stack.length > index) popElement();
  }

  function popElement() {
    const top = stack.pop();
    if (!top) return;
    if (top.name === null) dropped -= 1;
    else out.push(`</${top.name}>`);
  }
}

interface RawAttribute {
  name: string;
  value: string;
}

interface StartTag {
  name: string;
  attributes: RawAttribute[];
  selfClosing: boolean;
  /** Index just past the tag's `>`. */
  end: number;
}

/** Read a start tag the way the HTML tokenizer does, from just after its `<`. */
function readStartTag(input: string, from: number): StartTag {
  let i = from;
  while (i < input.length && !/[\s/>]/.test(input[i] as string)) i += 1;
  const name = input.slice(from, i);
  const attributes: RawAttribute[] = [];
  let selfClosing = false;

  while (i < input.length) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === ">") return { name, attributes, selfClosing, end: i + 1 };
    if (ch === "/") {
      selfClosing = input[i + 1] === ">";
      i += 1;
      continue;
    }
    selfClosing = false;
    const nameStart = i;
    i += 1;
    while (i < input.length && !/[\s/>=]/.test(input[i] as string)) i += 1;
    const attrName = input.slice(nameStart, i);
    while (i < input.length && /\s/.test(input[i] as string)) i += 1;
    let value = "";
    if (input[i] === "=") {
      i += 1;
      while (i < input.length && /\s/.test(input[i] as string)) i += 1;
      const quote = input[i];
      if (quote === '"' || quote === "'") {
        const close = input.indexOf(quote, i + 1);
        const stop = close === -1 ? input.length : close;
        value = input.slice(i + 1, stop);
        i = close === -1 ? input.length : close + 1;
      } else {
        const valueStart = i;
        while (i < input.length && !/[\s>]/.test(input[i] as string)) i += 1;
        value = input.slice(valueStart, i);
      }
    }
    attributes.push({ name: attrName, value: decodeEntities(value) });
  }
  return { name, attributes, selfClosing, end: input.length };
}

function serializeAttributes(
  attributes: readonly RawAttribute[],
  report: (removedActive: boolean) => void,
): string {
  const seen = new Set<string>();
  let result = "";
  for (const { name, value } of attributes) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (!ATTRIBUTE_NAME.test(name)) continue;
    if (lower.startsWith("on")) {
      report(true);
      continue;
    }
    const colon = lower.indexOf(":");
    const prefix = colon === -1 ? "" : lower.slice(0, colon);
    const local = lower.slice(colon + 1);
    // A file may bind the xlink namespace to any prefix (`xmlns:x` + `x:href`),
    // so every prefixed href is a link; other editor-namespaced attributes go.
    const isLink = local === "href" || lower === "src";
    if (!isLink && prefix !== "" && prefix !== "xlink" && prefix !== "xml" && prefix !== "xmlns") {
      continue;
    }

    let kept = value;
    if (isLink) {
      if (!isSafeUrl(value)) {
        report(true);
        continue;
      }
    } else if (lower === "style" || /url\s*\(|@import/i.test(value)) {
      const css = filterCss(value);
      if (css.removed) report(true);
      kept = css.value;
    }
    result += ` ${name}="${escapeAttribute(kept)}"`;
  }
  return result;
}

function isSafeUrl(value: string): boolean {
  // Browsers drop C0 controls and spaces around a URL and tabs/newlines inside
  // it, so `java\tscript:` and ` javascript:` both navigate.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the controls browsers strip
  const url = value.replace(/[ - -]/g, "");
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined) return true;
  if (scheme === "http" || scheme === "https" || scheme === "mailto") return true;
  return scheme === "data" && SAFE_DATA_IMAGE.test(url);
}

/**
 * Keep CSS to in-document drawing: no `@import`, no `url()` other than a
 * `#fragment`, and no escapes (`u\72l(` spells `url(` to the CSS parser).
 */
function filterCss(css: string): { value: string; removed: boolean } {
  let removed = false;
  const value = css
    .replace(/\\/g, () => {
      removed = true;
      return "";
    })
    .replace(/@import[^;]*;?/gi, () => {
      removed = true;
      return "";
    })
    .replace(/url\s*\(([^)]*)\)?/gi, (match, target: string) => {
      const inner = target.trim().replace(/^["']|["']$/g, "");
      if (inner.startsWith("#")) return match;
      removed = true;
      return "none";
    });
  return { value, removed };
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,8})|#([0-9]{1,9})|([A-Za-z][A-Za-z0-9]{0,31}));?/g,
    (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (named !== undefined) return NAMED_ENTITIES[named] ?? match;
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : "�";
    },
  );
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z]/.test(ch);
}

function tagName(raw: string): string {
  const match = /^[^\s/>]+/.exec(raw);
  return match?.[0] ?? "";
}
