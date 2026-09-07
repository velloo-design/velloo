#!/usr/bin/env bun
/**
 * Re-vendors the shadcn components in `src/components/ui/` from the upstream
 * registry.
 *
 * Run via `bun run vendor` from this package. Pass component ids to limit the
 * pull (`bun run vendor button card`); pass `--force` to overwrite a
 * canvas-adapted file (see ADAPTED below), which discards its shim.
 *
 * The registry serves each style's components with the `cn-*` semantic classes
 * already flattened into Tailwind utilities, so what lands here is the same
 * shape a user's `shadcn add` writes — no CSS indirection to resolve. Three
 * rewrites make an upstream file compile in this package:
 *
 *   1. `@/registry/<style>/lib/utils`  → `../../lib/utils.ts`
 *   2. `@/registry/<style>/ui/<id>`    → `./<id>.tsx`
 *   3. `<IconPlaceholder lucide="X" tabler=… />` → `<X />` + a lucide import.
 *      Upstream ships an icon-library-agnostic placeholder that carries one
 *      name per supported library; the shadcn CLI collapses it to the icon
 *      library in components.json. Velloo is lucide, same as @velloo/helpers.
 *
 * Bump `snapshotVersion` in package.json after a pull, then `bun run build`.
 */
import { readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const STYLE = (pkg as { shadcnStyle: string }).shadcnStyle;
const CLI_VERSION = (pkg as { shadcnCliVersion: string }).shadcnCliVersion;
const REGISTRY = `https://ui.shadcn.com/r/styles/${STYLE}`;
/**
 * The shared stylesheet the registry's components assume: the `data-open` /
 * `data-closed` / `data-checked` custom variants that normalize Radix's
 * `data-state` against Base UI's boolean attributes, plus the accordion
 * keyframes. Upstream ships it inside the `shadcn` CLI package and expects
 * `@import "shadcn/tailwind.css"`; we vendor the file instead so the snapshot
 * doesn't take a 300-package CLI dependency for one stylesheet.
 */
const SHARED_CSS = `https://unpkg.com/shadcn@${CLI_VERSION}/dist/tailwind.css`;

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = join(here, "src", "components", "ui");
const sharedCssPath = join(here, "src", "shadcn-tailwind.css");

/**
 * Components carrying a Velloo canvas adaptation — the inline-portal overlays
 * (see `src/components/canvas-portal.tsx`) and the SSR-safe stand-ins. A plain
 * re-vendor skips these so a routine pull can't silently revert the shim; take
 * one deliberately with `--force` and re-apply the adaptation by hand.
 */
const ADAPTED = new Set([
  // Overlays: content renders inline and pinned open instead of portalled.
  "alert-dialog",
  "combobox",
  "context-menu",
  "dialog",
  "drawer",
  "dropdown-menu",
  "hover-card",
  "menubar",
  "popover",
  "select",
  "sheet",
  "sonner",
  "tooltip",
  // Static-state contract: a design ships `checked` / `value` / `open` with no
  // handler to show a populated state, which React otherwise warns about and
  // renders inert. These promote it to the uncontrolled equivalent, and open
  // collapsed containers so the styling is visible without interaction.
  "accordion",
  "checkbox",
  "collapsible",
  "input",
  "slider",
  "switch",
  "textarea",
  "toggle-group",
  // JSON-shaped props: a design can only carry scalars, so these accept the ISO
  // string or plain value in place of the Date / rich object upstream expects.
  "calendar",
  // Preview stand-in: echarts SSRs to SVG, recharts renders nothing statically.
  "chart",
]);

interface RegistryItem {
  name: string;
  files?: { path: string; content: string; type: string }[];
}

/**
 * Upstream is not written against `exactOptionalPropertyTypes`, which this
 * repo turns on: it forwards a possibly-undefined prop into a slot typed as
 * required. Reapplied on every pull so a re-vendor stays type-clean; if one
 * stops matching, the pull fails loudly rather than leaving the fix silently
 * dropped. Keep these to genuine compile fixes — behaviour changes belong in
 * ADAPTED, not here.
 */
const PATCHES: Record<string, { find: string; replace: string }[]> = {
  // Empty as of the 2026.09.03 pull: every component that needed one also needed
  // a behaviour change, so it lives in ADAPTED and is maintained by hand.
};

function applyPatches(id: string, source: string): string {
  let out = source;
  for (const { find, replace } of PATCHES[id] ?? []) {
    if (!out.includes(find)) {
      throw new Error(`patch no longer applies — upstream changed around:\n${find.trim()}`);
    }
    out = out.replace(find, replace);
  }
  return out;
}

/**
 * Collapse one `<IconPlaceholder lucide="ChevronDownIcon" tabler=… />` element
 * to `<ChevronDownIcon … />`, dropping the other libraries' name props and
 * keeping every remaining attribute (className, data-slot, spreads) intact.
 * Returns the lucide names encountered so the caller can build the import.
 */
function collapseIconPlaceholders(source: string): { code: string; icons: Set<string> } {
  const icons = new Set<string>();
  const code = source.replace(/<IconPlaceholder\b([\s\S]*?)\/>/g, (whole, rawAttrs: string) => {
    const lucide = rawAttrs.match(/\blucide="([A-Za-z0-9]+)"/);
    if (!lucide?.[1]) return whole;
    const name = lucide[1];
    icons.add(name);
    const attrs = rawAttrs
      .replace(/\b(?:lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"\s*/g, "")
      .trim();
    return attrs ? `<${name}\n  ${attrs}\n/>` : `<${name} />`;
  });
  return { code, icons };
}

function rewriteImports(source: string): string {
  return source
    .replace(new RegExp(`"@/registry/${STYLE}/lib/utils"`, "g"), '"../../lib/utils.ts"')
    .replace(new RegExp(`"@/registry/${STYLE}/ui/([a-z-]+)"`, "g"), '"./$1.tsx"')
    .replace(/^import \{ IconPlaceholder \} from "[^"]*";?\n/gm, "");
}

function header(id: string): string {
  return [
    `// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/${id}).`,
    "// Snapshot version: see packages/shadcn-snapshot/package.json#snapshotVersion.",
    "// Regenerate with `bun run vendor` — do not hand-edit unless you are adding a",
    "// canvas adaptation, in which case add the id to vendor.ts's ADAPTED set.",
    "",
  ].join("\n");
}

async function vendor(id: string): Promise<void> {
  const res = await fetch(`${REGISTRY}/${id}.json`);
  if (!res.ok) throw new Error(`${id}: registry returned ${res.status}`);
  const item = (await res.json()) as RegistryItem;
  const file = item.files?.[0];
  if (!file) throw new Error(`${id}: registry item has no files`);

  const { code, icons } = collapseIconPlaceholders(file.content);
  let out = rewriteImports(code);
  if (icons.size > 0) {
    const names = [...icons].sort().join(", ");
    // Slot the lucide import next to the other package imports: after the
    // leading "use client" (if any) and the React import.
    const importLine = `import { ${names} } from "lucide-react";\n`;
    const anchor = out.match(/^import .*\n/m);
    out = anchor ? out.replace(anchor[0], `${anchor[0]}${importLine}`) : `${importLine}${out}`;
  }

  await writeFile(join(uiDir, `${id}.tsx`), `${header(id)}${applyPatches(id, out)}`, "utf8");
}

async function vendorSharedCss(): Promise<void> {
  const res = await fetch(SHARED_CSS);
  if (!res.ok) throw new Error(`shared css: ${SHARED_CSS} returned ${res.status}`);
  const banner = [
    `/* Vendored from shadcn@${CLI_VERSION} (dist/tailwind.css) — imported by`,
    " * tailwind-entry.css. Regenerate with `bun run vendor`; do not hand-edit.",
    " */",
    "",
  ].join("\n");
  await writeFile(sharedCssPath, `${banner}${await res.text()}`, "utf8");
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.filter((a) => !a.startsWith("--"));

const existing = (await readdir(uiDir))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""));
const ids = requested.length > 0 ? requested : existing;

const skipped: string[] = [];
const failed: string[] = [];
let written = 0;

for (const id of ids) {
  if (ADAPTED.has(id) && !force) {
    skipped.push(id);
    continue;
  }
  try {
    await vendor(id);
    written += 1;
  } catch (error) {
    failed.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The shared stylesheet is versioned with the components, so a full pull
// refreshes it; a targeted `bun run vendor button` leaves it alone.
if (requested.length === 0) {
  try {
    await vendorSharedCss();
    console.log(`✓ vendored src/shadcn-tailwind.css from shadcn@${CLI_VERSION}`);
  } catch (error) {
    failed.push(error instanceof Error ? error.message : String(error));
  }
}

console.log(`✓ vendored ${written} component(s) from ${REGISTRY}`);
if (skipped.length > 0) {
  console.log(`· skipped ${skipped.length} canvas-adapted: ${skipped.join(", ")}`);
}
if (failed.length > 0) {
  console.error(`✗ ${failed.length} failed:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
