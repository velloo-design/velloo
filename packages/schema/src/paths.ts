// Node-only module — exported as `@velloo/schema/paths`, deliberately NOT from
// the package index: the index is compiled into browser bundles where `node:*`
// imports fail. Mirrors `@velloo/helpers/paths`.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the schema sources. The canvas bundler resolves the
 * zero-dependency leaf modules the velloo helper components import
 * (`typeset`, `icon-name`, `svg-sanitize`) from here, because the installed
 * binary inlines `@velloo/*` into `cli.js` — a runtime `Bun.build` of the
 * shipped `.tsx` under `dist/pkgs` has no node_modules to walk up into.
 * Resolves from source (`here` = this `src/` dir) and from the bundled CLI,
 * where the CLI's `build.ts` copies these sources to `<dist>/pkgs/schema/src`.
 */
function resolveDir(): string {
  const candidates = [
    process.env.VELLOO_SCHEMA_SRC,
    join(here, "pkgs", "schema", "src"),
    here,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((d) => existsSync(join(d, "typeset.ts"))) ?? here;
}

export const schemaSrcDir: string = resolveDir();
