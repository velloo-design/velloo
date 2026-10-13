import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a font custom property comes from when no stylesheet sets it.
 *
 * `next/font` writes `--font-sans` onto `<html>` at runtime, from a call in
 * the root layout. The app's stylesheet and Tailwind config only ever mention
 * the variable, so a theme import sees a stack that starts from nothing — and
 * the family it needs is one file away, in a form that reads as data:
 * `Space_Grotesk({ variable: "--font-sans", weight: ["400", "700"] })`.
 */
export interface FontLoader {
  /** Host-relative file the loader call is in. */
  file: string;
  /** The family, for a Google font; a local font file has no name to give. */
  family?: string | undefined;
  /** Google Fonts axis spec for the weights the app loads; absent for a variable face. */
  google?: string | undefined;
}

/** Where apps keep the call: the root layout or custom app, or a fonts module beside it. */
const CANDIDATES = [
  "app/layout",
  "src/app/layout",
  "pages/_app",
  "src/pages/_app",
  "pages/_document",
  "src/pages/_document",
  "app/fonts",
  "src/app/fonts",
  "lib/fonts",
  "src/lib/fonts",
  "src/fonts",
  "styles/fonts",
  "src/styles/fonts",
].flatMap((stem) => ["tsx", "ts", "jsx", "js"].map((ext) => `${stem}.${ext}`));

function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** `["400", "500"]` → `wght@400;500`; `"variable"` or nothing → undefined: the face is variable, and its range is the catalogue's to say. */
function axisOf(options: string): string | undefined {
  const weight = /\bweight\s*:\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/.exec(options)?.[1];
  if (!weight) return undefined;
  const values = [...weight.matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((m) => m[1] as string)
    .filter((value) => /^\d{3}$/.test(value))
    .sort();
  return values.length > 0 ? `wght@${values.join(";")}` : undefined;
}

function loaderIn(source: string, cssVar: string): Omit<FontLoader, "file"> | null {
  const google = new Map<string, string>();
  for (const list of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']next\/font\/google["']/g)) {
    for (const part of (list[1] ?? "").split(",")) {
      const [imported, local] = part.trim().split(/\s+as\s+/);
      if (imported) google.set((local ?? imported).trim(), imported.trim().replace(/_/g, " "));
    }
  }
  const local = /import\s+(\w+)\s+from\s*["']next\/font\/local["']/.exec(source)?.[1];
  if (google.size === 0 && !local) return null;
  for (const call of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(\s*\{/g)) {
    const open = (call.index ?? 0) + call[0].length - 1;
    const close = closingBrace(source, open);
    if (close < 0) continue;
    const options = source.slice(open, close + 1);
    const variable = /\bvariable\s*:\s*["'`](--[\w-]+)["'`]/.exec(options)?.[1];
    if (variable !== cssVar) continue;
    const name = call[1] as string;
    const family = google.get(name);
    if (family) return { family, google: axisOf(options) };
    if (name === local) return {};
  }
  return null;
}

/** The loader call that sets `cssVar` (`--font-sans`) in the app at `hostRoot`, if one is found. */
export function findFontLoader(hostRoot: string, cssVar: string): FontLoader | null {
  for (const file of CANDIDATES) {
    const path = join(hostRoot, file);
    if (!existsSync(path)) continue;
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const found = loaderIn(source, cssVar);
    if (found) return { file, ...found };
  }
  return null;
}
