// Node-only module — exported as `@velloo/helpers/paths`, deliberately NOT from
// the package index: the index is compiled into browser bundles (velloo-cloud's
// share viewer imports the registries from source) where node:* imports fail.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the helper component sources. The server's Tailwind JIT
 * adds this directory to its class-candidate scan so the helpers' structural
 * default classes (Heading's size ladder, Placeholder's aspect classes, …)
 * compile no matter which provider's `componentsDir` is active. Resolves from
 * source (`here` = this `src/` dir) and from the bundled CLI, where the CLI's
 * `build.ts` copies these sources to `<dist>/pkgs/helpers/src`.
 */
function resolveDir(): string {
  const candidates = [
    process.env.VELLOO_HELPERS_SRC,
    join(here, "pkgs", "helpers", "src"),
    here,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((d) => existsSync(join(d, "heading.tsx"))) ?? here;
}

export const helpersComponentsDir: string = resolveDir();

const HELPER_SOURCE_FILES: Record<string, string> = {
  Box: "box.tsx",
  Divider: "divider.tsx",
  Gradient: "gradient.tsx",
  Heading: "heading.tsx",
  Icon: "icon.tsx",
  Image: "image.tsx",
  Layer: "layer.tsx",
  Placeholder: "placeholder.tsx",
  Prose: "prose.tsx",
  SVG: "svg.tsx",
  Text: "text.tsx",
};

/** Absolute source module for a framework-neutral helper, or undefined. */
export function helperSourcePath(id: string): string | undefined {
  const file = HELPER_SOURCE_FILES[id];
  return file ? join(helpersComponentsDir, file) : undefined;
}
