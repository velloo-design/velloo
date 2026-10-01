/**
 * The one pipeline that vendors shadcn into this repo.
 *
 * Velloo keeps two copies of upstream's components — the canvas-safe
 * design-mode fork in `@velloo/shadcn-snapshot`, and the real shadcn the IDE
 * chrome renders — because they have to *behave* differently: the snapshot's
 * overlays are pinned open and inline so they can be selected inside a static
 * design iframe, while the chrome needs real Radix portals and a working
 * toaster. What they do not need is two hand-maintained copies of the pull
 * itself, which is how they once drifted a full style apart (the snapshot on
 * radix-nova at 55 components, the chrome left on new-york at 21) with nothing
 * failing. One pipeline, one pin, two targets: see `targets.ts`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The upstream pull, in one place. The runner stamps it into every target's
 * package.json, and refuses anything short of a pull of every target while a
 * stamp disagrees with it — so a bump moves both copies or neither.
 *
 *   - `style` is a registry style; its components arrive with the `cn-*`
 *     semantic classes already flattened into Tailwind utilities, so what lands
 *     on disk is the shape a user's `shadcn add` writes.
 *   - `cliVersion` pins the shared stylesheet (`dist/tailwind.css`) upstream
 *     ships inside the CLI package and expects apps to `@import`.
 *   - `pull` dates the snapshot; it becomes `snapshotVersion`, which a
 *     scaffolded design records as its provider version.
 */
export const SHADCN_PIN = {
  style: "radix-nova",
  cliVersion: "4.21.0",
  pull: "2026.09.30",
} as const;

const REGISTRY = `https://ui.shadcn.com/r/styles/${SHADCN_PIN.style}`;
const REGISTRY_INDEX = "https://ui.shadcn.com/r/index.json";
const SHARED_CSS = `https://unpkg.com/shadcn@${SHADCN_PIN.cliVersion}/dist/tailwind.css`;

/** Repo root: this file lives at `<root>/scripts/vendor-shadcn/`. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Patch {
  readonly find: string;
  readonly replace: string;
}

export interface VendorTarget {
  /** `--target=<id>`, and the label the pull reports under. */
  readonly id: string;
  /** One line on what this copy is for, printed by `--list`. */
  readonly description: string;
  /** Package directory, relative to the repo root. */
  readonly packageDir: string;
  /** Where the components land, relative to `packageDir`. */
  readonly uiDir: string;
  /** Where upstream's shared stylesheet lands, relative to `packageDir`. */
  readonly sharedCssPath: string;
  /** The stylesheet that imports it, named in the vendored file's banner. */
  readonly sharedCssImporter: string;
  /** Rewrites for upstream's `@/registry/<style>/…` specifiers. */
  readonly imports: {
    readonly utils: string;
    readonly sibling: (id: string) => string;
  };
  /**
   * Whether `"use client"` survives. The snapshot is server-rendered by
   * `@velloo/renderer`; the chrome is a Vite SPA where the directive is dead
   * weight the rest of the package doesn't carry.
   */
  readonly keepUseClient: boolean;
  /** Second line of every vendored file's provenance header. */
  readonly headerNote: string;
  /**
   * Whether the pull date is stamped as `snapshotVersion`. Only where something
   * reads it back: `@velloo/shadcn-snapshot` reports it as the shadcn
   * provider's version.
   */
  readonly recordsPullDate: boolean;
  /**
   * Every registry id this target writes — complete, not "whatever is already
   * on disk". `registryDependencies` are resolved and checked against it
   * rather than silently expanding it, so the set on disk is the set declared
   * here and a file nobody declared shows up as an orphan.
   */
  readonly catalog: readonly string[];
  /**
   * Registry ids this target deliberately does not carry, each with its
   * reason. Together with `catalog` this has to cover every `registry:ui`
   * item upstream serves, which is what stops a family a pull adds from going
   * unnoticed — the failure mode that left 20 of them unreachable once.
   */
  readonly skipped: Readonly<Record<string, string>>;
  /**
   * Files carrying a hand-maintained divergence. A routine pull skips them so
   * it cannot silently revert one; `--force` overwrites deliberately and the
   * divergence then goes back on by hand.
   */
  readonly adapted: ReadonlySet<string>;
  /**
   * Mechanical compile fixes reapplied on every pull of a verbatim file. A
   * patch that stops matching fails the pull instead of being dropped. An
   * `adapted` file is never pulled routinely, so a patch there would go
   * unchecked for months — its fixes live in the file with the rest of its
   * divergence, and the pull rejects a patch aimed at one.
   */
  readonly patches: Readonly<Record<string, readonly Patch[]>>;
}

/** Only the fields the pull reads; upstream's items carry more. */
interface RegistryItem {
  readonly dependencies?: readonly string[];
  readonly registryDependencies?: readonly string[];
  readonly files?: readonly { readonly content: string }[];
}

/**
 * `cn` is the registry's own `lib/utils` helper, listed among a styled item's
 * `dependencies` beside real packages. Both targets already have it.
 */
const NOT_A_PACKAGE = new Set(["cn"]);

/** `react-day-picker@latest` ⇒ `react-day-picker`. */
function packageName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

/** The `registry:ui` items upstream serves, style-independent. */
export async function fetchRegistryUiIds(): Promise<Set<string>> {
  const index = (await fetchJson(REGISTRY_INDEX)) as { name: string; type: string }[];
  return new Set(index.filter((i) => i.type === "registry:ui").map((i) => i.name));
}

async function fetchItems(ids: readonly string[]): Promise<Map<string, RegistryItem>> {
  const items = new Map<string, RegistryItem>();
  // Upstream serves one file per item, so the pull is entirely fetch-bound.
  const batch = 8;
  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    const fetched = await Promise.all(
      slice.map(
        async (id) => [id, (await fetchJson(`${REGISTRY}/${id}.json`)) as RegistryItem] as const,
      ),
    );
    for (const [id, item] of fetched) items.set(id, item);
  }
  return items;
}

/**
 * Collapse one `<IconPlaceholder lucide="ChevronDownIcon" tabler=… />` to
 * `<ChevronDownIcon … />`, dropping the other libraries' name props and keeping
 * every remaining attribute intact. Upstream ships an icon-library-agnostic
 * placeholder carrying one name per supported library, which the shadcn CLI
 * collapses to whatever `components.json` names; Velloo is lucide throughout.
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

function rewriteImports(target: VendorTarget, source: string): string {
  const out = source
    // Two spellings of the same import: the registry used to point at
    // `@/registry/<style>/lib/utils`, and now emits a bare `"cn"` that the
    // shadcn CLI resolves against the aliases in a project's components.json.
    .replace(/from "cn"/g, `from "${target.imports.utils}"`)
    .replace(
      new RegExp(`"@/registry/${SHADCN_PIN.style}/lib/utils"`, "g"),
      `"${target.imports.utils}"`,
    )
    .replace(new RegExp(`"@/registry/${SHADCN_PIN.style}/ui/([a-z-]+)"`, "g"), (_, id: string) =>
      JSON.stringify(target.imports.sibling(id)),
    )
    .replace(/^import \{ IconPlaceholder \} from "[^"]*";?\n/gm, "");
  return target.keepUseClient ? out : out.replace(/^"use client";?\n+/m, "");
}

function applyPatches(target: VendorTarget, id: string, source: string): string {
  let out = source;
  for (const { find, replace } of target.patches[id] ?? []) {
    if (!out.includes(find)) {
      throw new Error(`${id}: patch no longer applies — upstream changed around:\n${find}`);
    }
    out = out.replace(find, replace);
  }
  return out;
}

function header(target: VendorTarget, id: string): string {
  return [
    `// Vendored from shadcn-ui (https://ui.shadcn.com/docs/components/radix/${id}).`,
    `// ${target.headerNote}`,
    "// Regenerate with `bun run vendor` — the pipeline is scripts/vendor-shadcn/.",
    "",
  ].join("\n");
}

/**
 * Import the collapsed icons, merged into the file's own lucide import when it
 * already has one — a second `import … from "lucide-react"` is a lint error.
 */
function importIcons(source: string, icons: ReadonlySet<string>): string {
  if (icons.size === 0) return source;
  const existing = source.match(/^import \{([^}]*)\} from "lucide-react";?\n/m);
  const names = new Set(icons);
  for (const name of existing?.[1]?.split(",") ?? []) {
    if (name.trim()) names.add(name.trim());
  }
  const line = `import { ${[...names].sort().join(", ")} } from "lucide-react";\n`;
  if (existing) return source.replace(existing[0], line);
  // Beside the other package imports: after "use client" and the React import.
  const anchor = source.match(/^import .*\n/m);
  return anchor ? source.replace(anchor[0], `${anchor[0]}${line}`) : `${line}${source}`;
}

export function render(target: VendorTarget, id: string, item: RegistryItem): string {
  const file = item.files?.[0];
  if (!file) throw new Error(`${id}: the ${SHADCN_PIN.style} registry item has no files`);
  const { code, icons } = collapseIconPlaceholders(file.content);
  const out = importIcons(rewriteImports(target, code), icons);
  return `${header(target, id)}${applyPatches(target, id, out)}`;
}

/**
 * The npm packages each item imports that this package does not depend on. An
 * upstream component whose dependency is missing is never written — it would
 * compile-fail at build time, far from the pull that caused it, so adding
 * Calendar (react-day-picker) or Command (cmdk) stays a deliberate dependency
 * decision rather than a build break discovered later.
 */
function missingPackages(
  items: ReadonlyMap<string, RegistryItem>,
  installed: ReadonlySet<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, item] of items) {
    const missing = (item.dependencies ?? [])
      .filter((d) => !NOT_A_PACKAGE.has(d))
      .map(packageName)
      .filter((p) => !installed.has(p));
    if (missing.length > 0) out.set(id, missing);
  }
  return out;
}

/**
 * What a target declares has to be self-consistent regardless of upstream:
 * each id decided once, and every divergence or patch aimed at a component the
 * target carries — a patch on an `adapted` one included, since a routine pull
 * never writes that file and the patch would never be checked.
 */
export function declarationProblems(target: VendorTarget): string[] {
  const problems: string[] = [];
  const catalog = new Set(target.catalog);
  if (catalog.size !== target.catalog.length) problems.push("the catalog lists an id twice");
  for (const id of catalog) {
    if (id in target.skipped) problems.push(`${id}: in the catalog and in the skip list`);
  }
  for (const id of target.adapted) {
    if (!catalog.has(id)) problems.push(`${id}: adapted, but not in the catalog`);
  }
  for (const id of Object.keys(target.patches)) {
    if (!catalog.has(id)) problems.push(`${id}: patched, but not in the catalog`);
    if (target.adapted.has(id)) {
      problems.push(`${id}: patched, but adapted — carry the fix in the file itself`);
    }
  }
  return problems;
}

/**
 * Catalog plus skip list has to match what upstream serves in both directions:
 * a family upstream adds must be decided, and one it drops (or renames) must
 * not linger as a skip reason nobody can check or a catalog entry that 404s.
 */
export function coverageProblems(target: VendorTarget, registryUi: ReadonlySet<string>): string[] {
  const declared = new Set([...target.catalog, ...Object.keys(target.skipped)]);
  const problems: string[] = [];
  const undecided = [...registryUi].filter((id) => !declared.has(id));
  if (undecided.length > 0) {
    problems.push(
      `upstream serves ${undecided.length} component(s) this target neither carries nor skips: ` +
        `${undecided.join(", ")} — add each to the catalog or give it a reason in skipped`,
    );
  }
  const gone = [...declared].filter((id) => !registryUi.has(id));
  if (gone.length > 0) {
    problems.push(
      `declared but no longer served upstream: ${gone.join(", ")} — ` +
        "drop each from the catalog or skip list, or follow its rename",
    );
  }
  return problems;
}

/**
 * Every registry dependency of a wanted component wanted too, and every npm
 * package a *verbatim* component imports already a dependency of the package.
 */
function dependencyProblems(
  target: VendorTarget,
  items: ReadonlyMap<string, RegistryItem>,
  missing: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  const catalog = new Set(target.catalog);
  for (const [id, item] of items) {
    for (const dep of item.registryDependencies ?? []) {
      // A full URL points at a third-party registry, not at this catalog.
      if (dep.includes("/") || catalog.has(dep)) continue;
      const why = target.skipped[dep];
      problems.push(
        why === undefined
          ? `${id} depends on "${dep}", which the catalog does not declare`
          : `${id} depends on "${dep}", which is skipped (${why})`,
      );
    }
    // A missing package is only a contradiction for a component this target
    // takes verbatim. An adaptation is often there *because* upstream's package
    // is unwanted — the snapshot's Chart is on echarts, its overlays on
    // canvas-portal instead of vaul, its Calendar on ISO strings instead of
    // date-fns — so for those it is a skip with a reason, reported by the pull.
    const gap = missing.get(id);
    if (gap && !target.adapted.has(id)) {
      problems.push(
        `${id} needs ${gap.join(", ")} — add the dependency to ${target.packageDir}/package.json, ` +
          "adapt the component, or move it to skipped",
      );
    }
  }
  return problems;
}

/** The package.json fields a pull stamps into this target, and their values. */
function pinStamps(target: VendorTarget): Record<string, string> {
  return {
    shadcnStyle: SHADCN_PIN.style,
    shadcnCliVersion: SHADCN_PIN.cliVersion,
    ...(target.recordsPullDate ? { snapshotVersion: SHADCN_PIN.pull } : {}),
  };
}

function packageJsonPath(target: VendorTarget): string {
  return join(repoRoot, target.packageDir, "package.json");
}

/** The stamps in this target's package.json that disagree with `SHADCN_PIN`. */
export async function pinDrift(target: VendorTarget): Promise<string[]> {
  const pkg = JSON.parse(await readFile(packageJsonPath(target), "utf8")) as Record<
    string,
    unknown
  >;
  return Object.entries(pinStamps(target))
    .filter(([key, value]) => pkg[key] !== value)
    .map(([key, value]) => `${key} ${JSON.stringify(pkg[key])} ≠ "${value}"`);
}

/** Rewrite one `"key": "value"` in place, so the rest of the file is untouched. */
function stamp(where: string, source: string, key: string, value: string): string {
  const field = new RegExp(`("${key}":\\s*)"[^"]*"`);
  if (!field.test(source)) {
    throw new Error(`${where} has no "${key}" field for the pull to stamp`);
  }
  return source.replace(field, `$1"${value}"`);
}

async function fetchSharedCss(target: VendorTarget): Promise<string> {
  const res = await fetch(SHARED_CSS);
  if (!res.ok) throw new Error(`shared css: ${SHARED_CSS} returned ${res.status}`);
  const banner = [
    `/* Vendored from shadcn@${SHADCN_PIN.cliVersion} (dist/tailwind.css) — imported by`,
    ` * ${target.sharedCssImporter}. Regenerate with \`bun run vendor\`; do not hand-edit.`,
    " */",
    "",
  ].join("\n");
  return `${banner}${await res.text()}`;
}

function uiDirOf(target: VendorTarget): string {
  return join(repoRoot, target.packageDir, target.uiDir);
}

/** The component ids in a target's ui directory, sorted. */
export async function componentsOnDisk(target: VendorTarget): Promise<string[]> {
  return (await readdir(uiDirOf(target)))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""))
    .sort();
}

/**
 * Upstream ships prettier-formatted sources and this repo is on Biome, so a raw
 * pull leaves a hundred-odd formatting diffs and a few `import type` findings.
 * Formatting here rather than leaving it to a remembered `lint:fix` keeps a
 * pull a single step that ends with a clean tree.
 */
export function format(dirs: readonly string[]): string | undefined {
  const run = Bun.spawnSync(["bunx", "biome", "check", "--write", ...dirs], {
    cwd: repoRoot,
    stdout: "ignore",
    stderr: "pipe",
  });
  return run.exitCode === 0 ? undefined : run.stderr.toString().trim();
}

export interface VendorOptions {
  /** Limit the pull to these registry ids; empty means the whole catalog. */
  readonly ids: readonly string[];
  /** Overwrite an `adapted` file, discarding its divergence. */
  readonly force: boolean;
}

/**
 * Everything one target's pull will write, computed up front. Every check that
 * can fail — the catalog, the dependencies, a patch that no longer applies, a
 * missing stamp field, a fetch — fails while building this, so a pull of two
 * targets either writes both or neither and cannot leave their stamps split.
 */
export interface VendorPlan {
  readonly target: VendorTarget;
  /** The components the pull writes. */
  readonly written: readonly string[];
  /** The components it leaves alone, each with why. */
  readonly skipped: readonly string[];
  /** Files on disk that the catalog does not declare. */
  readonly orphans: readonly string[];
  /** Absolute path ⇒ contents: the components, plus the shared CSS and stamps of a whole pull. */
  readonly writes: ReadonlyMap<string, string>;
}

export async function planTarget(
  target: VendorTarget,
  options: VendorOptions,
  registryUi: ReadonlySet<string>,
): Promise<VendorPlan> {
  const full = options.ids.length === 0;
  const ids = full ? target.catalog : options.ids;
  const unknown = ids.filter((id) => !target.catalog.includes(id));
  if (unknown.length > 0) {
    throw new Error(`${target.id}: not in the catalog: ${unknown.join(", ")}`);
  }

  const pkgPath = packageJsonPath(target);
  const pkgSource = await readFile(pkgPath, "utf8");
  const pkg = JSON.parse(pkgSource) as { dependencies?: Record<string, string> };
  const installed = new Set(Object.keys(pkg.dependencies ?? {}));

  const items = await fetchItems(ids);
  const missing = missingPackages(items, installed);
  const problems = [
    ...declarationProblems(target),
    // A targeted pull sees only part of the catalog, so it can't judge coverage.
    ...(full
      ? [...coverageProblems(target, registryUi), ...dependencyProblems(target, items, missing)]
      : []),
  ];
  if (problems.length > 0) {
    throw new Error(`${target.id}: the catalog does not hold up:\n  - ${problems.join("\n  - ")}`);
  }

  const uiDir = uiDirOf(target);
  const writes = new Map<string, string>();
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [id, item] of items) {
    if (target.adapted.has(id) && !options.force) {
      skipped.push(`${id} (adapted)`);
      continue;
    }
    // Reachable only under --force, and only for an adapted component: the
    // coherence check rejects a verbatim one with a dependency this package
    // doesn't carry. Reported rather than written, so a blanket force-pull
    // says which shims it could not take upstream's source for.
    const gap = missing.get(id);
    if (gap) {
      skipped.push(`${id} (needs ${gap.join(", ")})`);
      continue;
    }
    writes.set(join(uiDir, `${id}.tsx`), render(target, id, item));
    written.push(id);
  }

  let orphans: string[] = [];
  if (full) {
    writes.set(
      join(repoRoot, target.packageDir, target.sharedCssPath),
      await fetchSharedCss(target),
    );
    const where = `${target.packageDir}/package.json`;
    let stamped = pkgSource;
    for (const [key, value] of Object.entries(pinStamps(target))) {
      stamped = stamp(where, stamped, key, value);
    }
    writes.set(pkgPath, stamped);
    // Reported, never deleted: a rename upstream, or a file someone added by
    // hand instead of declaring it in the catalog.
    orphans = (await componentsOnDisk(target)).filter((f) => !target.catalog.includes(f));
  }

  return { target, written, skipped, orphans, writes };
}

export async function writePlan(plan: VendorPlan): Promise<void> {
  for (const [path, source] of plan.writes) await writeFile(path, source, "utf8");
}
