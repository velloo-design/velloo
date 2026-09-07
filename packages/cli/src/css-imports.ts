/**
 * The npm packages a shipped stylesheet `@import`s.
 *
 * Providers' Tailwind entry CSS reaches for packages by bare specifier
 * (`@import "tailwindcss"`, `@import "tw-animate-css"`). Nothing imports those
 * from JS, so the bundler never sees them, they never land in the published
 * manifest's dependencies — and the JIT then fails to resolve them at runtime,
 * which fails the whole CSS compile and turns every screen into a white box.
 * The bundle derives its externals from this rather than a hand-kept list,
 * because the failure is invisible until someone installs the tarball.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `@import "x"`, `@import url(x)`, `@import "x" layer(y) screen`. */
const IMPORT_RE = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;"')]+))/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/**
 * The package name a bare specifier resolves against: `tw-animate-css` from
 * `tw-animate-css/dist/x.css`, `@scope/pkg` from `@scope/pkg/x.css`. Returns
 * null for anything that isn't an npm specifier — a relative or absolute path,
 * or a remote URL, none of which need a dependency.
 */
function importedPackage(specifier: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(specifier)) return null;
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const segments = specifier.split("/");
  const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
  return name === undefined || name === "" ? null : name;
}

/**
 * Packages `@import`ed by one stylesheet. Comments are stripped first: the
 * snapshot's entry CSS documents upstream's own `@import "shadcn/tailwind.css"`
 * in prose, and reading that as a dependency would add a 300-package CLI to
 * every install.
 */
export function cssImportedPackages(css: string): Set<string> {
  const packages = new Set<string>();
  for (const match of css.replace(BLOCK_COMMENT_RE, "").matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier === undefined) continue;
    const name = importedPackage(specifier);
    if (name !== null) packages.add(name);
  }
  return packages;
}

/** Every package `@import`ed by any `.css` under `dir`, recursively. */
export function cssImportedPackagesIn(dir: string): Set<string> {
  const packages = new Set<string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
    const file = join(entry.parentPath, entry.name);
    for (const name of cssImportedPackages(readFileSync(file, "utf8"))) packages.add(name);
  }
  return packages;
}
