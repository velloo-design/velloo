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

export function parseTailwindContainer(src: string): ContainerConfig | null {
  const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
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
