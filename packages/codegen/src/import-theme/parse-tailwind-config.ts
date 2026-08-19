/**
 * Best-effort extraction of Tailwind's `container` config from a
 * tailwind.config.{ts,js,…} source. A code-to-design port often customizes
 * the container (centered, fixed padding, a max-width cap), but that lives in
 * JS config — not the stylesheet `import_theme` parses — and Velloo has no
 * container *theme* concept to apply it to. So this surfaces it as guidance:
 * the equivalent utility classes to wrap page content in.
 *
 * Tolerant by design — a shape it can't read yields null rather than a guess.
 * Pure text → data; no I/O, no config evaluation.
 */
export interface ContainerConfig {
  center?: boolean;
  /** Padding value (the plain string, or the `DEFAULT` of a per-screen object). */
  padding?: string;
  /** Largest screen max-width found, e.g. "1400px". */
  maxWidth?: string;
}

/** Index of the brace matching the `{` at `open` (or -1 when unbalanced). */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Drop line + block comments so brace matching isn't fooled by `// }`. */
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The inner body of the first `<keyRe>{ … }` object, or null if absent/unbalanced. */
function objectBody(src: string, keyRe: RegExp): string | null {
  const key = src.search(keyRe);
  if (key === -1) return null;
  const open = src.indexOf("{", key);
  if (open === -1) return null;
  const end = matchBrace(src, open);
  if (end === -1) return null;
  return src.slice(open + 1, end);
}

export function parseTailwindContainer(src: string): ContainerConfig | null {
  const stripped = stripComments(src);
  const key = stripped.search(/\bcontainer\s*:\s*\{/);
  if (key === -1) return null;
  const open = stripped.indexOf("{", key);
  const end = matchBrace(stripped, open);
  if (end === -1) return null;
  const body = stripped.slice(open + 1, end);

  const out: ContainerConfig = {};
  const center = /\bcenter\s*:\s*(true|false)/.exec(body);
  if (center) out.center = center[1] === "true";

  // padding: "2rem"  OR  padding: { DEFAULT: "2rem", … }
  const padStr = /\bpadding\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
  if (padStr) {
    out.padding = padStr[1];
  } else {
    const padObj = /\bpadding\s*:\s*\{[^}]*?DEFAULT\s*:\s*["'`]([^"'`]+)["'`]/.exec(body);
    if (padObj) out.padding = padObj[1];
  }

  // screens: { "2xl": "1400px", … } → the largest px cap
  const screensBody = /\bscreens\s*:\s*\{([^}]*)\}/.exec(body)?.[1];
  if (screensBody) {
    const pxs = [...screensBody.matchAll(/:\s*["'`](\d+)px["'`]/g)]
      .map((m) => Number(m[1]))
      .filter((n) => !Number.isNaN(n));
    if (pxs.length > 0) out.maxWidth = `${Math.max(...pxs)}px`;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Map a CSS length to a Tailwind spacing step (1 = 0.25rem), else an arbitrary value. */
function paddingClass(p: string): string {
  const rem = /^([\d.]+)rem$/.exec(p);
  const px = /^([\d.]+)px$/.exec(p);
  const units = rem ? Number(rem[1]) * 4 : px ? Number(px[1]) / 4 : null;
  return units !== null && Number.isInteger(units) && units >= 0 ? `px-${units}` : `px-[${p}]`;
}

/** The Velloo/Tailwind utility classes that reproduce a parsed container. */
export function containerClasses(c: ContainerConfig): string {
  const parts = [c.center ? "mx-auto" : "", "w-full"];
  if (c.padding) parts.push(paddingClass(c.padding));
  if (c.maxWidth) parts.push(`max-w-[${c.maxWidth}]`);
  return parts.filter(Boolean).join(" ");
}

/**
 * Best-effort extraction of `theme.extend`'s token namespaces from a
 * tailwind.config source — the colors, shadows, and font stacks an app
 * customizes in JS rather than in the stylesheet `parseThemeCss` reads. Lets
 * `import_theme` ingest the *real* library's `bg-paprika` / `shadow-card` /
 * `font-display` instead of leaving the agent to re-register them by hand.
 *
 * Tolerant + pure text → data, like `parseTailwindContainer`: a value it can't
 * read (a `require()`, a function, a spread) is skipped, never guessed. Only
 * literal string / array / one-level-nested-object shapes are captured.
 * `keyframes` and deep color scales are out of scope here.
 */
export interface ThemeExtend {
  /** Flat color map; nested scales flatten to `name-step` (e.g. `brand-500`). */
  colors?: Record<string, string>;
  /** Named box-shadows, e.g. `{ card: "0 2px 8px ..." }`. */
  boxShadow?: Record<string, string>;
  /** Font stacks keyed by role; array values join to a comma list. */
  fontFamily?: Record<string, string>;
  /** `@keyframes` defs: name → selector ("0%" / "from") → CSS declarations. */
  keyframes?: Record<string, Record<string, Record<string, string>>>;
  /** Animation shorthands keyed by utility name, e.g. `{ "fade-in": "fadeIn .3s ease-out" }`. */
  animation?: Record<string, string>;
}

/** CSS-ident-safe token key (so it can't inject into the emitted `--<name>`). */
const SAFE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function unquote(raw: string): string | null {
  const m = /^(["'`])([\s\S]*)\1$/.exec(raw.trim());
  return m ? (m[2] as string) : null;
}

/**
 * Split an object body into top-level `key: value` pairs, tracking string and
 * bracket depth so commas inside nested objects/arrays/strings don't split a
 * value. Values are returned raw (still quoted / still `[...]`).
 */
function topLevelEntries(body: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const n = body.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,;]/.test(body[i] as string)) i++;
    if (i >= n) break;
    // Key: a quoted string or a bare identifier.
    let key: string;
    const c0 = body[i] as string;
    if (c0 === '"' || c0 === "'" || c0 === "`") {
      let j = i + 1;
      while (j < n && body[j] !== c0) j++;
      key = body.slice(i + 1, j);
      i = j + 1;
    } else {
      let j = i;
      while (j < n && /[A-Za-z0-9_$-]/.test(body[j] as string)) j++;
      key = body.slice(i, j);
      i = j;
    }
    while (i < n && /\s/.test(body[i] as string)) i++;
    if (body[i] !== ":" || key === "") {
      // Not a key:value (a method, a spread, …) — skip to the next top-level
      // comma so one odd entry can't abort the whole parse.
      i = skipValue(body, i);
      continue;
    }
    i++; // ':'
    while (i < n && /\s/.test(body[i] as string)) i++;
    const start = i;
    i = skipValue(body, i);
    entries.push([key, body.slice(start, i).trim()]);
    i++; // trailing comma (or past end)
  }
  return entries;
}

/** Advance past one value, stopping at the top-level comma that ends it. */
function skipValue(body: string, from: number): number {
  const n = body.length;
  let i = from;
  let depth = 0;
  let str: string | null = null;
  while (i < n) {
    const c = body[i] as string;
    if (str) {
      if (c === "\\") i++;
      else if (c === str) str = null;
    } else if (c === '"' || c === "'" || c === "`") {
      str = c;
    } else if (c === "{" || c === "[" || c === "(") {
      depth++;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
    } else if (c === "," && depth === 0) {
      break;
    }
    i++;
  }
  return i;
}

/** Quoted strings inside an array literal, in order. */
function stringArray(raw: string): string[] {
  return [...raw.matchAll(/(["'`])([\s\S]*?)\1/g)].map((m) => m[2] as string);
}

function parseStringRecord(body: string | null): Record<string, string> | undefined {
  if (body === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of topLevelEntries(body)) {
    const value = unquote(raw);
    if (value === null) continue; // not a literal string (function, ref, …)
    const k = key.toLowerCase();
    if (SAFE_KEY.test(k)) out[k] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseColors(body: string | null): Record<string, string> | undefined {
  if (body === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of topLevelEntries(body)) {
    const name = key.toLowerCase();
    const value = unquote(raw);
    if (value !== null) {
      if (SAFE_KEY.test(name)) out[name] = value;
      continue;
    }
    // One level of nesting: `brand: { 500: "#…" }` → `brand-500`.
    if (raw.startsWith("{")) {
      const inner = objectBody(raw, /^\s*\{/);
      if (!inner) continue;
      for (const [sub, subRaw] of topLevelEntries(inner)) {
        const subVal = unquote(subRaw);
        const flat = `${name}-${sub.toLowerCase()}`;
        if (subVal !== null && SAFE_KEY.test(flat)) out[flat] = subVal;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseFontFamily(body: string | null): Record<string, string> | undefined {
  if (body === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of topLevelEntries(body)) {
    const k = key.toLowerCase();
    if (!SAFE_KEY.test(k)) continue;
    const single = unquote(raw);
    if (single !== null) {
      out[k] = single;
    } else if (raw.startsWith("[")) {
      const stack = stringArray(raw).join(", ");
      if (stack) out[k] = stack;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A keyframe selector: `from` / `to` / percentage(s) — and nothing that could break out of the block. */
const SAFE_STEP = /^(from|to|[\d.%,\s]+)$/i;
/** A CSS property name (after camelCase→kebab), optionally a custom property. */
const SAFE_PROP = /^-{0,2}[a-z][a-z0-9-]*$/;
/**
 * A keyframes identifier — case-preserving (an `animation` shorthand references
 * it verbatim, so lowercasing `fadeIn` to `fadein` would break the link).
 */
const SAFE_IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function parseKeyframes(
  body: string | null,
): Record<string, Record<string, Record<string, string>>> | undefined {
  if (body === null) return undefined;
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const [name, rawObj] of topLevelEntries(body)) {
    if (!SAFE_IDENT.test(name) || !rawObj.startsWith("{")) continue;
    const stepsBody = objectBody(rawObj, /^\s*\{/);
    if (!stepsBody) continue;
    const steps: Record<string, Record<string, string>> = {};
    for (const [step, rawDecls] of topLevelEntries(stepsBody)) {
      if (!SAFE_STEP.test(step.trim()) || !rawDecls.startsWith("{")) continue;
      const declsBody = objectBody(rawDecls, /^\s*\{/);
      if (!declsBody) continue;
      const decls: Record<string, string> = {};
      for (const [prop, rawVal] of topLevelEntries(declsBody)) {
        const cssProp = kebab(prop);
        const value = unquote(rawVal);
        // Reject anything that could escape the declaration (no `{};`).
        if (value === null || /[{};]/.test(value) || !SAFE_PROP.test(cssProp)) continue;
        decls[cssProp] = value;
      }
      if (Object.keys(decls).length > 0) steps[step.trim()] = decls;
    }
    if (Object.keys(steps).length > 0) out[name] = steps;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseThemeExtend(src: string): ThemeExtend | null {
  const extend = objectBody(stripComments(src), /\bextend\s*:\s*\{/);
  if (extend === null) return null;
  const out: ThemeExtend = {};
  const colors = parseColors(objectBody(extend, /\bcolors\s*:\s*\{/));
  if (colors) out.colors = colors;
  const boxShadow = parseStringRecord(objectBody(extend, /\bboxShadow\s*:\s*\{/));
  if (boxShadow) out.boxShadow = boxShadow;
  const fontFamily = parseFontFamily(objectBody(extend, /\bfontFamily\s*:\s*\{/));
  if (fontFamily) out.fontFamily = fontFamily;
  const keyframes = parseKeyframes(objectBody(extend, /\bkeyframes\s*:\s*\{/));
  if (keyframes) out.keyframes = keyframes;
  // `animation` values are shorthands (`fadeIn .3s ease-out`) — same string-map
  // shape as boxShadow, so the same reader applies.
  const animation = parseStringRecord(objectBody(extend, /\banimation\s*:\s*\{/));
  if (animation) out.animation = animation;
  return Object.keys(out).length > 0 ? out : null;
}
