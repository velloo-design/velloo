#!/usr/bin/env bun
/**
 * Regenerates src/icon-data.ts from the installed lucide-react.
 *
 * Run via `bun run generate:icons` from this package after bumping
 * lucide-react. The output is checked in so the helpers runtime carries
 * zero lucide-react dependency — only this generator (and the snapshot
 * components) need it, as a devDependency.
 *
 * Extraction strategy: lucide-react's ESM dist ships one module per
 * canonical icon (`dist/esm/icons/<kebab>.mjs`) exporting `__iconNode`
 * (the flat [tag, attrs][] SVG child list); alias modules re-export the
 * canonical default without an `__iconNode`. The barrel exports ~3 names
 * per icon (Name / NameIcon / LucideName). We keep one node array per
 * canonical icon and map every other name onto it by component identity,
 * so aliases cost a string each instead of a duplicated array.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type IconNodeChild = [string, Record<string, string | number>];

function lucideRoot(): string {
  let dir = dirname(Bun.resolveSync("lucide-react", import.meta.dir));
  for (;;) {
    const pkgPath = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
      if (pkg.name === "lucide-react") return dir;
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("could not locate the lucide-react package root");
    dir = parent;
  }
}

const root = lucideRoot();
const version = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  }
).version;
const iconsDir = join(root, "dist", "esm", "icons");

const iconFiles = readdirSync(iconsDir)
  .filter((f) => f.endsWith(".mjs") && f !== "index.mjs")
  .sort();

// canonical kebab name -> node data, and component identity -> kebab name.
const nodes = new Map<string, IconNodeChild[]>();
const byComponent = new Map<unknown, string>();
// kebab alias modules (re-export only, no __iconNode) resolved in a second
// pass once every canonical component identity is known.
const aliasFiles: { kebab: string; component: unknown }[] = [];

for (const file of iconFiles) {
  const kebab = basename(file, ".mjs");
  const mod = (await import(pathToFileURL(join(iconsDir, file)).href)) as {
    __iconNode?: unknown;
    default: unknown;
  };
  if (!Array.isArray(mod.__iconNode)) {
    aliasFiles.push({ kebab, component: mod.default });
    continue;
  }
  const children: IconNodeChild[] = mod.__iconNode.map((child) => {
    if (!Array.isArray(child) || typeof child[0] !== "string") {
      throw new Error(`${kebab}: unexpected __iconNode shape`);
    }
    const [tag, rawAttrs] = child as [string, Record<string, unknown>];
    const attrs: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(rawAttrs)) {
      // `key` is lucide's React reconciliation hint — the runtime keys by
      // index instead, so dropping it shrinks the file.
      if (k === "key") continue;
      if (typeof v !== "string" && typeof v !== "number") {
        throw new Error(`${kebab}: attr ${k} has unsupported type ${typeof v}`);
      }
      attrs[k] = v;
    }
    return [tag, attrs];
  });
  nodes.set(kebab, children);
  byComponent.set(mod.default, kebab);
}

// Every export name (PascalCase, Icon-suffixed, Lucide-prefixed — whatever the
// barrel ships) -> canonical kebab. Identity matching also naturally excludes
// non-icon exports (createLucideIcon, DynamicIcon, the `icons` namespace, …).
const barrel = (await import(
  pathToFileURL(join(root, "dist", "esm", "lucide-react.mjs")).href
)) as Record<string, unknown>;
const aliases = new Map<string, string>();
for (const [name, value] of Object.entries(barrel)) {
  const kebab = byComponent.get(value);
  if (kebab !== undefined && name !== kebab) aliases.set(name, kebab);
}
for (const { kebab, component } of aliasFiles) {
  const canonical = byComponent.get(component);
  if (canonical === undefined) throw new Error(`${kebab}: alias points at an unknown component`);
  aliases.set(kebab, canonical);
}

if (nodes.size === 0 || aliases.size === 0)
  throw new Error("extracted no icons — dist layout changed?");

const quoteKey = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));
const attrsSrc = (attrs: Record<string, string | number>) =>
  `{ ${Object.entries(attrs)
    .map(([k, v]) => `${quoteKey(k)}: ${JSON.stringify(v)}`)
    .join(", ")} }`;
const nodeSrc = (children: IconNodeChild[]) =>
  `[${children.map(([tag, attrs]) => `[${JSON.stringify(tag)}, ${attrsSrc(attrs)}]`).join(", ")}]`;

const nodeEntries = [...nodes.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([kebab, children]) => `  ${JSON.stringify(kebab)}: ${nodeSrc(children)},`)
  .join("\n");
const aliasEntries = [...aliases.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, kebab]) => `  ${JSON.stringify(name)}: ${JSON.stringify(kebab)},`)
  .join("\n");

const out = `// biome-ignore-all format: generated single-line-per-icon layout
// biome-ignore-all lint: generated
// GENERATED FILE — do not hand-edit.
// Regenerate with \`bun run generate:icons\` (scripts/generate-icon-data.ts),
// which extracts SVG node data from the installed lucide-react.
// Icon data © Lucide contributors, ISC license (https://lucide.dev).

export const LUCIDE_VERSION = ${JSON.stringify(version)};

/** One SVG child element of an icon: [tag, attributes]. */
export type IconNodeChild = [tag: string, attrs: Record<string, string | number>];
/** The flat child-element list of one lucide icon (lucide nodes never nest). */
export type IconNode = IconNodeChild[];

/** lucide's standard root <svg> attributes, shared by every icon. */
export const LUCIDE_SVG_ATTRIBUTES = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Canonical kebab-case icon name → SVG node data. */
export const ICON_NODES: Record<string, IconNode> = {
${nodeEntries}
};

/** Every other resolvable name (lucide-react export names + kebab alias ids) → canonical kebab key. */
export const ICON_ALIASES: Record<string, string> = {
${aliasEntries}
};
`;

const outPath = join(import.meta.dir, "..", "src", "icon-data.ts");
writeFileSync(outPath, out);
console.log(
  `wrote ${outPath}: ${nodes.size} icons, ${aliases.size} aliases, lucide-react@${version}, ${(out.length / 1024).toFixed(0)} KiB`,
);
