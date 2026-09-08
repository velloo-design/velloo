import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Manifest } from "@velloo/provider";

/**
 * Read-only shadcn host-app discovery. Design composition resolves against
 * Velloo's bundled runtime; emission reports these registry names when the
 * host app still needs a component.
 */

/** PascalCase → shadcn registry name ("DropdownMenu" → "dropdown-menu"). */
function kebab(id: string): string {
  return id.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
}

/**
 * Look up the shadcn CLI's installable unit for a manifest id
 * (`ButtonGroupSeparator` → `button-group`, `Toaster` → `sonner`).
 *
 * A lookup rather than a rule, because the rule cannot be made safe. This was
 * a hand-kept list of families matched by longest prefix, and a family missing
 * from it did not fail closed — `ButtonGroup` fell through to `Button` and
 * resolved to `button.tsx`, a file that exists, compiles, and exports
 * something else entirely. `build.ts` already reads the filename each
 * component was vendored from, so ask it.
 *
 * The kebab fallback is for an id the manifest does not carry — a host-only
 * component, or one added upstream since the snapshot — where a guess is all
 * there is and being wrong only costs a fallback render.
 */
export function addNameIndex(manifest: Manifest): (id: string) => string {
  const byId = new Map(
    manifest.flatMap((c) => (c.registryName ? [[c.id, c.registryName] as const] : [])),
  );
  return (id) => byId.get(id) ?? kebab(id);
}

/**
 * Where the app's shadcn ui components live. Prefers the app's own
 * `components.json` (`aliases.ui` / `aliases.components`, `@/` mapped onto
 * `src/` when it exists), then the conventional locations. Null when the app
 * has no discoverable ui dir yet (nothing installed).
 */
export function findUiDir(hostAppRoot: string): string | null {
  const candidates: string[] = [];
  try {
    const cj = JSON.parse(readFileSync(join(hostAppRoot, "components.json"), "utf8")) as {
      aliases?: { ui?: string; components?: string };
    };
    const fromAlias = (alias: string | undefined, suffix = ""): void => {
      if (!alias) return;
      const srcBase = existsSync(join(hostAppRoot, "src")) ? "src" : "";
      const rel = alias.replace(/^@\//, srcBase ? `${srcBase}/` : "") + suffix;
      candidates.push(resolve(hostAppRoot, rel));
    };
    fromAlias(cj.aliases?.ui);
    fromAlias(cj.aliases?.components, "/ui");
  } catch {
    // No components.json (or unreadable) — fall through to conventions.
  }
  candidates.push(
    resolve(hostAppRoot, "src/components/ui"),
    resolve(hostAppRoot, "components/ui"),
    resolve(hostAppRoot, "app/components/ui"),
  );
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/** Registry names (kebab) already present as files in the app's ui dir. */
export function installedAddNames(hostAppRoot: string): Set<string> {
  const dir = findUiDir(hostAppRoot);
  if (!dir) return new Set();
  try {
    return new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => f.replace(/\.(tsx|ts)$/, "")),
    );
  } catch {
    return new Set();
  }
}
