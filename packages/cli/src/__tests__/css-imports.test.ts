import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssImportedPackages, cssImportedPackagesIn } from "../css-imports.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const packagesDir = join(repoRoot, "packages");

/**
 * The bundle derives its runtime dependencies from these, so a miss here ships
 * a package that fails to resolve at runtime — which fails the whole Tailwind
 * compile and renders every screen as a white box. Nothing catches that from
 * the source tree, where the packages are always installed.
 */
describe("cssImportedPackages", () => {
  test("names the package a bare specifier resolves against", () => {
    expect(cssImportedPackages('@import "tailwindcss";')).toEqual(new Set(["tailwindcss"]));
    expect(cssImportedPackages("@import 'tw-animate-css';")).toEqual(new Set(["tw-animate-css"]));
  });

  test("keeps both segments of a scoped package and drops the subpath", () => {
    expect(cssImportedPackages('@import "@acme/theme/dist/x.css";')).toEqual(
      new Set(["@acme/theme"]),
    );
    expect(cssImportedPackages('@import "pkg/dist/x.css";')).toEqual(new Set(["pkg"]));
  });

  test("reads the url() form and a trailing layer()/media suffix", () => {
    expect(cssImportedPackages("@import url(tw-animate-css);")).toEqual(
      new Set(["tw-animate-css"]),
    );
    expect(cssImportedPackages('@import "pkg" layer(utilities) screen;')).toEqual(new Set(["pkg"]));
  });

  test("ignores anything that needs no dependency", () => {
    expect(cssImportedPackages('@import "./shadcn-tailwind.css";')).toEqual(new Set());
    expect(cssImportedPackages('@import "../x.css";')).toEqual(new Set());
    expect(cssImportedPackages('@import "/abs/x.css";')).toEqual(new Set());
    expect(cssImportedPackages('@import "https://cdn.example.com/x.css";')).toEqual(new Set());
    expect(cssImportedPackages('@import "//cdn.example.com/x.css";')).toEqual(new Set());
  });

  /**
   * The snapshot's entry CSS documents upstream's own `@import "shadcn/…"` in
   * prose; reading that as real would add a 300-package CLI to every install.
   */
  test("ignores an @import inside a comment", () => {
    const css = `/*
      * Upstream tells apps to \`@import "shadcn/tailwind.css"\`.
      */
     @import "tailwindcss";`;
    expect(cssImportedPackages(css)).toEqual(new Set(["tailwindcss"]));
  });

  test("collects every import in a file", () => {
    const css = '@import "tailwindcss";\n@import "./local.css";\n@import "tw-animate-css";';
    expect(cssImportedPackages(css)).toEqual(new Set(["tailwindcss", "tw-animate-css"]));
  });
});

describe("the stylesheets the bundle ships", () => {
  /**
   * Every package directory `build.ts` copies into `dist/pkgs`. Scanning the
   * real sources rather than a fixture is the point: it is what makes adding an
   * `@import` to a provider's entry CSS fail here instead of after packaging.
   */
  const shipped = [
    "helpers",
    "shadcn-snapshot",
    "provider-none",
    "provider-mui",
    "provider-antd",
    "provider-chakra",
  ]
    .map((pkg) => join(packagesDir, pkg, "src"))
    .filter((dir) => existsSync(dir))
    .map((dir) => ({ dir, packages: cssImportedPackagesIn(dir) }));

  const imported = new Set(shipped.flatMap(({ packages }) => [...packages]));

  test("are found by the scan at all", () => {
    // A scan that silently returns nothing would let the bug straight through.
    expect(shipped.length).toBeGreaterThan(0);
    expect(imported.size).toBeGreaterThan(0);
  });

  test("import the packages the canvas cannot render without", () => {
    // tailwindcss is the utility engine; tw-animate-css supplies every
    // `animate-in` / `fade-in-0` class the overlays are written against.
    expect(imported).toContain("tailwindcss");
    expect(imported).toContain("tw-animate-css");
  });

  test("import only packages that resolve from the stylesheet's own directory", () => {
    // The same walk-up the JIT does at runtime, from the same place. Also what
    // build.ts needs to pin each package to its installed version.
    for (const { dir, packages } of shipped) {
      for (const pkg of packages) {
        expect(() => Bun.resolveSync(`${pkg}/package.json`, dir)).not.toThrow();
      }
    }
  });
});
