import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compile } from "@tailwindcss/node";

/**
 * An app's global stylesheet is usually a Tailwind *source*, not CSS: a v3 app
 * writes `@tailwind base` and `@apply font-mono uppercase` and lets PostCSS
 * expand them, a v4 app writes `@import "tailwindcss"`, `@theme` and
 * `@utility`. Handed raw to a CSS bundler those rules are invalid and dropped —
 * `.label { @apply … }` vanishes and `h1 { @apply uppercase }` keeps only its
 * plain declarations — so the app's own classes never render on the canvas.
 *
 * This expands such a sheet with Velloo's embedded Tailwind, against the app's
 * own `tailwind.config` when it has one, the way the app's build would. It
 * emits the sheet's rules only: Velloo's JIT already supplies preflight and
 * every utility a design or a host component uses, so the Tailwind directives
 * that would generate those again are dropped, and the default theme is read
 * by reference with values inlined, so the app's sheet never redefines the
 * theme variables the canvas paints with.
 */

const TAILWIND_AT_RULE =
  /@(tailwind|apply|config|theme|utility|plugin|custom-variant|variant|source|reference)\b/;
const TAILWIND_IMPORT = /@import\s+(?:url\()?\s*["']tailwindcss(?:\/[^"']*)?["']/;

/** Whether a stylesheet uses Tailwind syntax a plain CSS bundler can't expand. */
export function needsTailwind(css: string): boolean {
  return TAILWIND_AT_RULE.test(css) || TAILWIND_IMPORT.test(css);
}

const CONFIG_NAMES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

/**
 * The `tailwind.config.*` that governs a stylesheet: the nearest one at or
 * above its directory, stopping at the package that owns it — the config a
 * v3 PostCSS build would load for it.
 */
export function tailwindConfigFor(stylesheet: string): string | null {
  let dir = dirname(resolve(stylesheet));
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const path = join(dir, name);
      if (existsSync(path)) return path;
    }
    if (existsSync(join(dir, "package.json"))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let tailwindDir: string | null = null;
/** Velloo's own Tailwind v4 — never the app's, which may be v3 or absent. */
function vellooTailwind(): string {
  tailwindDir ??= dirname(Bun.resolveSync("tailwindcss/package.json", import.meta.dir));
  return tailwindDir;
}

async function resolveTailwindCss(id: string): Promise<string | undefined> {
  if (id === "tailwindcss") return join(vellooTailwind(), "index.css");
  if (!id.startsWith("tailwindcss/")) return undefined;
  const sub = id.slice("tailwindcss/".length);
  return join(vellooTailwind(), sub.endsWith(".css") ? sub : `${sub}.css`);
}

/** `@utility tab-4 { … }` names, minus functional ones (`tab-*`), which need a value. */
function staticUtilities(css: string): string[] {
  return [...css.matchAll(/@utility\s+([a-zA-Z0-9_-]+)\s*\{/g)].map((m) => m[1] as string);
}

/**
 * The sheet rewritten as a Tailwind v4 input that emits only its own rules:
 * the directives that would generate preflight and utilities go, and the
 * default theme comes in by reference so `@apply` resolves without
 * redefining a single theme variable.
 */
function asV4Input(css: string, config: string | null): string {
  const body = css
    .replace(/@tailwind\s+[a-z-]+\s*;/g, "")
    .replace(/@import\s+(?:url\()?\s*["']tailwindcss(?:\/[^"']*)?["']\s*\)?[^;]*;/g, "");
  const head = ['@import "tailwindcss/theme.css" theme(reference inline);'];
  // A v4 sheet opts into a JS config itself; a v3 one gets the app's implicitly.
  if (config && !/@config\b/.test(css) && !TAILWIND_IMPORT.test(css)) {
    head.push(`@config ${JSON.stringify(config)};`);
  }
  // Emits only the candidates `expand` passes: the sheet's own `@utility` rules.
  return `${head.join("\n")}\n${body}\n@tailwind utilities;\n`;
}

export type HostStylesheetResult = { ok: true; css: string } | { ok: false; error: string };

const cache = new Map<string, Promise<HostStylesheetResult>>();
const CACHE_LIMIT = 32;

function mtime(path: string | null): number {
  if (!path) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Expand one host stylesheet's Tailwind syntax into plain CSS. Never throws:
 * a sheet Velloo's Tailwind can't process (a v3-only plugin, a `prefix`)
 * comes back as an error the caller reports, and the caller decides what to
 * render instead.
 */
export function compileHostStylesheet(path: string, css: string): Promise<HostStylesheetResult> {
  const config = tailwindConfigFor(path);
  const key = `${path}\0${Bun.hash(css)}\0${config}\0${mtime(config)}`;
  let result = cache.get(key);
  if (!result) {
    result = expand(path, css, config);
    cache.set(key, result);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  return result;
}

async function expand(
  path: string,
  css: string,
  config: string | null,
): Promise<HostStylesheetResult> {
  try {
    const compiler = await compile(asV4Input(css, config), {
      base: dirname(path),
      from: path,
      shouldRewriteUrls: true,
      onDependency: () => {},
      customCssResolver: resolveTailwindCss,
    });
    return { ok: true, css: compiler.build(staticUtilities(css)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.split("\n")[0] ?? message };
  }
}
