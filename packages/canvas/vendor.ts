#!/usr/bin/env bun
/**
 * Re-vendors the canvas's shadcn components in `src/components/ui/` from the
 * upstream registry.
 *
 * Run via `bun run vendor` from this package. Pass component ids to limit the
 * pull (`bun run vendor button card`).
 *
 * This is the IDE chrome's copy: **real** shadcn, with real Radix portals,
 * working dialogs and a live Sonner toaster. It is deliberately not
 * `@velloo/shadcn-snapshot`, whose overlays are pinned open and inline so they
 * can be selected inside a static design iframe — see the "two copies, one
 * upstream pull" invariant in CLAUDE.md. Divergence here is the exception, not
 * the contract: prefer a wrapper in `src/components/`, and only when the file
 * itself must change does it earn a place in ADAPTED below.
 *
 * Both copies read their style and CLI pin from their own package.json so the
 * two can be compared at a glance and moved together.
 */
import { readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "./package.json" with { type: "json" };

const manifest = pkg as unknown as {
  shadcnStyle: string;
  shadcnCliVersion: string;
  dependencies: Record<string, string>;
};
const STYLE = manifest.shadcnStyle;
const CLI_VERSION = manifest.shadcnCliVersion;
const REGISTRY = `https://ui.shadcn.com/r/styles/${STYLE}`;
/** The `data-open` / `data-closed` variants and keyframes the components assume. */
const SHARED_CSS = `https://unpkg.com/shadcn@${CLI_VERSION}/dist/tailwind.css`;

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = join(here, "src", "components", "ui");
const sharedCssPath = join(here, "src", "shadcn-tailwind.css");

/**
 * The chrome's catalog. Explicit rather than "whatever is already on disk":
 * the directory drifted to 21 components while the design-mode snapshot moved
 * to 55, and the gap was invisible because nothing declared what the canvas
 * was supposed to have. `registryDependencies` are resolved transitively, so
 * this lists only what the app reaches for directly.
 */
const COMPONENTS = [
  "accordion",
  "alert",
  "alert-dialog",
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "button-group",
  "card",
  "checkbox",
  "collapsible",
  "context-menu",
  "dialog",
  "dropdown-menu",
  "empty",
  "field",
  "hover-card",
  "input",
  "input-group",
  "item",
  "kbd",
  "label",
  "native-select",
  "popover",
  "progress",
  "scroll-area",
  "select",
  "separator",
  "skeleton",
  "slider",
  "sonner",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle",
  "toggle-group",
  "tooltip",
  // Chat set, for the comment threads.
  "bubble",
  "message",
];

/**
 * Files carrying a hand-maintained divergence. A plain re-vendor skips them so
 * a routine pull can't silently revert one; take it deliberately with
 * `--force` and re-apply by hand.
 *
 * Keep this set small — unlike the snapshot's, whose whole reason to exist is
 * the canvas-safe contract, a divergence here is a bug being worked around or
 * an accessibility fix upstream hasn't taken. Four today, and the two forks
 * that used to live here (select's `size`, dropdown-menu's icon sizing) both
 * went away at the 2026.09 pull because upstream shipped them.
 */
const ADAPTED = new Set([
  // aria-label moved onto the thumb, where Radix puts role="slider"; plus a
  // `tone` prop for a control showing an inherited rather than authored value.
  "slider",
  // Upstream's Toaster reads next-themes; the canvas owns its own dark mode.
  "sonner",
  // SubContent is portalled in both: upstream renders it inside the parent
  // Content, whose `overflow-x-hidden overflow-y-auto` clips every submenu away.
  "dropdown-menu",
  "context-menu",
]);

/**
 * Upstream is not written against `exactOptionalPropertyTypes`, which this repo
 * turns on: it forwards a possibly-undefined prop into a slot typed as
 * required. Reapplied on every pull, and a patch that stops matching fails the
 * pull rather than being silently dropped. Genuine compile fixes only —
 * anything behavioural belongs in ADAPTED.
 */
const PATCHES: Record<string, { find: string; replace: string }[]> = {
  slider: [
    {
      find: "      defaultValue={defaultValue}\n      value={value}\n",
      replace:
        "      {...(defaultValue === undefined ? {} : { defaultValue })}\n" +
        "      {...(value === undefined ? {} : { value })}\n",
    },
  ],
  "dropdown-menu": [
    {
      find: "      checked={checked}\n",
      replace: "      {...(checked === undefined ? {} : { checked })}\n",
    },
  ],
  "context-menu": [
    {
      find: "      checked={checked}\n",
      replace: "      {...(checked === undefined ? {} : { checked })}\n",
    },
  ],
};

function applyPatches(id: string, source: string): string {
  let out = source;
  for (const { find, replace } of PATCHES[id] ?? []) {
    if (!out.includes(find)) {
      throw new Error(`${id}: patch no longer applies — upstream changed around:\n${find}`);
    }
    out = out.replace(find, replace);
  }
  return out;
}

interface RegistryItem {
  name: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files?: { path: string; content: string; type: string }[];
}

/** `react-day-picker@latest` ⇒ `react-day-picker`. */
function packageName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

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
  return (
    source
      .replace(new RegExp(`"@/registry/${STYLE}/lib/utils"`, "g"), '"@/lib/utils"')
      .replace(new RegExp(`"@/registry/${STYLE}/ui/([a-z-]+)"`, "g"), '"@/components/ui/$1"')
      .replace(/^import \{ IconPlaceholder \} from "[^"]*";?\n/gm, "")
      // A Vite SPA has no server components; the directive is dead weight and
      // the rest of this package doesn't carry it.
      .replace(/^"use client";?\n+/m, "")
  );
}

function header(id: string): string {
  return [
    `// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/${id}).`,
    "// Real shadcn for the IDE chrome — NOT the canvas-safe snapshot fork.",
    "// Regenerate with `bun run vendor`; do not hand-edit.",
    "",
  ].join("\n");
}

/**
 * Resolve `registryDependencies` transitively, so the catalog lists intent and
 * the pull still lands the pieces those components import.
 */
async function collect(ids: readonly string[]): Promise<Map<string, RegistryItem>> {
  const items = new Map<string, RegistryItem>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || items.has(id)) continue;
    const res = await fetch(`${REGISTRY}/${id}.json`);
    if (!res.ok) throw new Error(`${id}: registry returned ${res.status}`);
    const item = (await res.json()) as RegistryItem;
    items.set(id, item);
    // Registry deps can be full URLs for third-party registries; those are not
    // something this catalog should be pulling in implicitly.
    for (const dep of item.registryDependencies ?? []) {
      if (!dep.includes("/")) queue.push(dep);
    }
  }
  return items;
}

async function write(id: string, item: RegistryItem): Promise<void> {
  const file = item.files?.[0];
  if (!file) throw new Error(`${id}: registry item has no files`);
  const { code, icons } = collapseIconPlaceholders(file.content);
  let out = rewriteImports(code);
  if (icons.size > 0) {
    const importLine = `import { ${[...icons].sort().join(", ")} } from "lucide-react";\n`;
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
    " * styles.css. Regenerate with `bun run vendor`; do not hand-edit.",
    " */",
    "",
  ].join("\n");
  await writeFile(sharedCssPath, `${banner}${await res.text()}`, "utf8");
}

const force = process.argv.includes("--force");
const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = requested.length > 0 ? requested : COMPONENTS;

const items = await collect(ids);

/**
 * A component whose npm dependencies aren't already installed is skipped, not
 * silently written: it would compile-fail at build time, far from the pull that
 * caused it. Adding `calendar` (react-day-picker) or `command` (cmdk) to the
 * chrome should be a deliberate dependency decision.
 */
const installed = new Set(Object.keys(manifest.dependencies));
const skipped: string[] = [];
const written: string[] = [];
const failed: string[] = [];

for (const [id, item] of items) {
  if (ADAPTED.has(id) && !force) {
    skipped.push(`${id} (adapted)`);
    continue;
  }
  const missing = (item.dependencies ?? []).map(packageName).filter((p) => !installed.has(p));
  if (missing.length > 0) {
    skipped.push(`${id} (needs ${missing.join(", ")})`);
    continue;
  }
  try {
    await write(id, item);
    written.push(id);
  } catch (error) {
    failed.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (requested.length === 0) {
  try {
    await vendorSharedCss();
    console.log(`✓ vendored src/shadcn-tailwind.css from shadcn@${CLI_VERSION}`);
  } catch (error) {
    failed.push(error instanceof Error ? error.message : String(error));
  }
  // Files on disk that the catalog no longer names — a rename upstream, or a
  // component someone added by hand. Reported, never deleted.
  const onDisk = (await readdir(uiDir))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""));
  const orphans = onDisk.filter((f) => !items.has(f));
  if (orphans.length > 0) console.log(`· not in the catalog: ${orphans.join(", ")}`);
}

/**
 * Upstream ships prettier-formatted sources and this repo is on Biome, so a
 * raw pull leaves ~120 formatting diffs. Formatting here rather than leaving it
 * to a remembered `lint:fix` keeps "vendor" a single step that ends with a
 * clean tree.
 */
if (written.length > 0) {
  const format = Bun.spawnSync(["bunx", "biome", "check", "--write", uiDir], {
    cwd: join(here, "..", ".."),
    stdout: "ignore",
    stderr: "pipe",
  });
  if (format.exitCode !== 0) {
    // Not fatal: the files are on disk and correct, they just aren't formatted.
    console.error(`! biome could not format the pull:\n${format.stderr.toString().trim()}`);
  }
}

console.log(`✓ vendored ${written.length} component(s) from ${REGISTRY}`);
if (skipped.length > 0) console.log(`· skipped ${skipped.length}: ${skipped.join(", ")}`);
if (failed.length > 0) {
  console.error(`✗ ${failed.length} failed:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
