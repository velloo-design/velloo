/**
 * emit_code: agent-consumed intermediate representation for a screen.
 *
 * emit_code is an agent-consumed IR, not a paste-ready file. The
 * agent reads this IR alongside the user's app code and writes the real file
 * in the user's conventions (their import paths, their prettier config, their
 * wrappers). Velloo's job is to be honest about what's in the screen — the
 * JSX shape, the library identifiers used, the snippets it references, the
 * Tailwind classes baked in.
 *
 * What `emit_code` no longer does:
 *   - generate `import { ... } from "..."` blocks (the agent picks paths)
 *   - write to a file (the agent writes; emit_code is pure)
 *   - diff against an existing file (no target file exists yet)
 *
 * Formatting is a package-wide non-goal, not an emit_code one — see the
 * package README. Nothing in @velloo/codegen runs a formatter.
 *
 * What `emit_code` still does:
 *   - serialize the screen tree to a JSX string using library identifiers
 *     verbatim (`<Button>`, `<Card>`, `<FeatureCard />` for snippets) and the
 *     Tailwind classes from the design verbatim
 *   - apply Tailwind class consolidation (no duplicates, deterministic merge
 *     order on conflicts) as an IR quality property
 *   - report `componentsUsed`, `snippetsUsed`, `iconsUsed`, `classesUsed` so
 *     the agent can plan imports + theme scans without re-walking the tree
 */
import { $, DoAsync, type Result } from "@velloo/result";
import {
  type Extension,
  isComponentNode,
  isSnippetInstance,
  type Node,
  pascalizeIconName,
  type Screen,
  type Snippet,
} from "@velloo/schema";
import {
  helpersToMaterialize,
  isKnownLucideIcon,
  REMOVED_BRAND_ICONS,
  resolveLucideJsxName,
  shadcnInstallTargets,
} from "../component-registry.ts";
import type { CodegenError } from "../errors.ts";
import type { CodegenTarget } from "./target.ts";
import { emitTree } from "./tree-to-jsx.ts";

/** Structured emit IR for a single screen. Pure data; no I/O happened. */
export interface EmitCodeResult {
  /** The screen's id + name, echoed back for convenience. */
  screen: { id: string; name: string };
  /**
   * JSX body using library identifiers (`<Button>`, `<Card>`) and Tailwind
   * classes verbatim. No imports, no function wrapper — the agent decides
   * what to wrap this in (a Next.js page, a Storybook story, a route file).
   */
  jsx: string;
  /**
   * Library component identifiers referenced anywhere in the tree, sorted.
   * The agent maps these to imports — typically `@/components/ui/*` for
   * shadcn primitives, the same alias the user's app uses.
   */
  componentsUsed: string[];
  /**
   * Bare specifiers that appear in the JSX as JSX names (e.g. lucide icon
   * names rendered as `<Sparkles />`, `<ArrowRight />`). The agent imports
   * these from `lucide-react`.
   */
  iconsUsed: string[];
  /**
   * Snippets referenced by the screen, with each snippet's own IR. The
   * agent decides whether to materialize each as a real component in the
   * user's app or inline the subtree.
   */
  snippetsUsed: EmitSnippetIR[];
  /**
   * Unique Tailwind classes appearing in the rendered JSX. The agent can
   * use this to verify the user's tailwind config covers everything used.
   */
  classesUsed: string[];
  /**
   * shadcn primitives (transitively) used that need installing in the
   * user's app — kebab names ready for `npx shadcn@latest add <names>`.
   * Velloo helpers and lucide icons are excluded (no install needed).
   */
  componentsToInstall: string[];
  /**
   * Velloo composition helpers (Gradient, SVG, Image, Layer, Divider) used
   * that the agent must author in the app — emit keeps their identifier
   * because they carry runtime logic. Box/Heading/Text/Icon are excluded
   * (they lower to plain HTML / lucide).
   */
  helpersToMaterialize: string[];
  /**
   * Non-fatal emit caveats — things that couldn't be expressed faithfully
   * in JSX and need agent attention (e.g. a dynamic Icon name baked to its
   * fallback). Empty when the screen body emits cleanly; per-snippet
   * caveats live on each `snippetsUsed[].warnings`.
   */
  warnings: string[];
}

export interface EmitSnippetIR {
  id: string;
  /** PascalCase name the agent should use when materializing as a component. */
  componentName: string;
  /** Typed parameters the snippet declares (name + type, defaults preserved). `optional` → emit `name?` (omittable slot/prop). */
  params: { name: string; type: string; default?: string; optional?: boolean }[];
  /** JSX body of the snippet, same shape as a screen's `jsx`. */
  jsx: string;
  /** shadcn primitives used in this snippet body needing install (see EmitCodeResult). */
  componentsToInstall: string[];
  /** Velloo composition helpers used in this snippet body to author (see EmitCodeResult). */
  helpersToMaterialize: string[];
  /** Non-fatal emit caveats for this snippet body (see EmitCodeResult.warnings). */
  warnings: string[];
}

export interface EmitCodeOptions {
  /**
   * Components-folder alias the IR's import paths *would* use if the agent
   * chose to inline them — supplied only so the IR walker can build
   * snippet-instance JSX uniformly. The agent ignores this field when
   * writing imports.
   */
  componentsAlias?: string | undefined;
  snippetsAlias?: string | undefined;
  /** Snippets registry — required if the screen tree contains $snippet instances. */
  snippets?: Map<string, Snippet> | undefined;
  /**
   * Extensions registry — folder-global custom components.
   * Required for emit_code to emit imports for any extension $refs in the
   * tree; without it, references to a registered extension surface as
   * `UnknownComponent`. Pass `Object.entries(config.extensions ?? {})`
   * mapped to importPath-only records.
   */
  extensions?: Record<string, Extension> | undefined;
  /**
   * Framework target (MUI, …). When set, component ids resolve to the
   * framework's native imports instead of the shadcn REGISTRY, and the
   * shadcn-only `componentsToInstall` / `helpersToMaterialize` lists are
   * suppressed (they don't apply to a non-shadcn framework). Absent ⇒ shadcn.
   */
  target?: CodegenTarget | undefined;
  /**
   * No-CSS-framework folder (`config.styling.framework === "none"`): the no-lib
   * primitives emit as plain HTML with inline `style` defaults (Tailwind-free),
   * and the shadcn install lists are suppressed. Absent ⇒ class-based.
   */
  inlineStyle?: boolean | undefined;
}

const DEFAULT_ALIAS = "@/components/ui";

function pascal(input: string): string {
  return (
    input
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Screen"
  );
}

function buildSnippetPascalMap(snippets: Map<string, Snippet> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!snippets) return out;
  for (const [id, snippet] of snippets) out.set(id, pascal(snippet.name || id));
  return out;
}

/**
 * Extract unique Tailwind class tokens from a JSX string. Conservative —
 * scans `className="..."` literals only. Template-literal classNames (used
 * for snippet extraClassName) are not split. The agent uses the result as
 * a hint, not a guarantee, so partial coverage is acceptable.
 */
function extractClasses(jsx: string): string[] {
  const seen = new Set<string>();
  for (const match of jsx.matchAll(/className="([^"]*)"/g)) {
    const classes = (match[1] ?? "").trim().split(/\s+/);
    for (const c of classes) if (c) seen.add(c);
  }
  return [...seen].sort();
}

/** Walk a tree, collecting metadata about what it references. */
function collectMetadata(
  root: Node,
  snippets: Map<string, Snippet> | undefined,
): {
  components: Set<string>;
  icons: Set<string>;
  unresolvedIcons: Set<string>;
  snippetIds: Set<string>;
} {
  const components = new Set<string>();
  const icons = new Set<string>();
  const unresolvedIcons = new Set<string>();
  const snippetIds = new Set<string>();
  // Nodes can also live inside *props* (a `children` prop carrying inline rich
  // text / an Icon, a slot prop) — emitTree renders those, so metadata must
  // count them too. Mirrors build-tree's resolvePropChildren.
  function walkPropValue(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) walkPropValue(item);
      return;
    }
    if (value && typeof value === "object" && ("$ref" in value || "$snippet" in value)) {
      walk(value as Node);
    }
  }
  function walk(node: Node): void {
    if (isComponentNode(node)) {
      components.add(node.$ref);
      // Icon's `name` prop drives an inline lucide JSX; record the name
      // so the agent imports it. Same resolver as the registry entry —
      // invalid/missing names render <HelpCircle />, which needs an import too.
      if (node.$ref === "Icon") {
        icons.add(resolveLucideJsxName(node.props?.name));
        // A $param/$if name is a caller-filled slot, warned about separately
        // by dynamicIconWarningsForTree — only literal names resolve here.
        const literal = node.props?.name;
        if (typeof literal === "string" && !isKnownLucideIcon(literal)) {
          unresolvedIcons.add(literal);
        }
      }
      for (const val of Object.values(node.props ?? {})) walkPropValue(val);
      for (const child of node.children ?? []) walk(child);
      return;
    }
    if (isSnippetInstance(node)) {
      snippetIds.add(node.$snippet);
      // Also descend into the snippet body so transitive components surface.
      const body = snippets?.get(node.$snippet);
      if (body) walk(body.tree);
      return;
    }
  }
  walk(root);
  return { components, icons, unresolvedIcons, snippetIds };
}

/**
 * The emit-time backstop for an icon name that never passed through a
 * mutation (hand-edited JSON, an import, a merge) and so never saw the
 * server's advisory.
 */
function unresolvedIconWarning(name: string): string {
  const fix = REMOVED_BRAND_ICONS.has(pascalizeIconName(name))
    ? "lucide dropped brand glyphs — use the `SVG` helper (it inherits currentColor, so it theme-flips with the design) or `Image`"
    : "check the name against lucide's icon list";
  return `Icon name ${JSON.stringify(name)} is not a lucide export — emitted as <HelpCircle /> to keep the code compiling. ${fix}.`;
}

/** Emit one screen as agent-consumed IR. Pure: no I/O, no diff, no write. */
export async function emitCode(
  screen: Screen,
  options: EmitCodeOptions = {},
): Promise<Result<EmitCodeResult, CodegenError>> {
  return DoAsync<EmitCodeResult, CodegenError>(async function* () {
    const componentsAlias = options.componentsAlias ?? DEFAULT_ALIAS;
    const snippetPascalById = buildSnippetPascalMap(options.snippets);
    const extensionsMap = buildExtensionsMap(options.extensions);
    const warnings: string[] = [];
    const ctx = {
      componentsAlias,
      snippetsAlias: options.snippetsAlias,
      snippetPascalById,
      snippets: options.snippets,
      extensions: extensionsMap,
      target: options.target,
      inlineStyle: options.inlineStyle,
      warnings,
      indent: (d: number) => "  ".repeat(d),
    };
    const body = yield* $(emitTree(screen.tree, ctx));

    const meta = collectMetadata(screen.tree, options.snippets);
    for (const name of [...meta.unresolvedIcons].sort()) warnings.push(unresolvedIconWarning(name));

    // Emit each referenced snippet's IR. Recurse via emitSnippet so the
    // snippet's own componentName / params / jsx are carried.
    const snippetIRs: EmitSnippetIR[] = [];
    for (const id of [...meta.snippetIds].sort()) {
      const snippet = options.snippets?.get(id);
      if (!snippet) continue;
      const snippetR = yield* $(
        await emitSnippet(snippet, {
          componentsAlias,
          snippets: options.snippets,
          extensions: options.extensions,
          target: options.target,
          inlineStyle: options.inlineStyle,
        }),
      );
      snippetIRs.push(snippetR);
    }

    // A non-shadcn target (MUI) or a no-CSS-framework folder has no shadcn
    // components to `npx shadcn add` and no velloo helpers to materialize.
    const native = options.target !== undefined || Boolean(options.inlineStyle);
    return {
      screen: { id: screen.id, name: screen.name },
      jsx: body,
      componentsUsed: [...meta.components].sort(),
      iconsUsed: [...meta.icons].sort(),
      snippetsUsed: snippetIRs,
      classesUsed: extractClasses(body),
      componentsToInstall: native ? [] : shadcnInstallTargets(meta.components),
      helpersToMaterialize: native ? [] : helpersToMaterialize(meta.components),
      warnings: [...new Set(warnings)],
    };
  });
}

export interface EmitSnippetOptions {
  componentsAlias?: string | undefined;
  snippetsAlias?: string | undefined;
  snippets?: Map<string, Snippet> | undefined;
  /** Folder-global extensions — same shape as `EmitCodeOptions.extensions`. */
  extensions?: Record<string, Extension> | undefined;
  /** Framework target — same shape + meaning as `EmitCodeOptions.target`. */
  target?: CodegenTarget | undefined;
  /** No-CSS-framework folder — same shape + meaning as `EmitCodeOptions.inlineStyle`. */
  inlineStyle?: boolean | undefined;
}

function buildExtensionsMap(
  extensions: Record<string, Extension> | undefined,
): Map<string, { importPath: string }> | undefined {
  if (!extensions) return undefined;
  const m = new Map<string, { importPath: string }>();
  for (const [id, ext] of Object.entries(extensions)) m.set(id, { importPath: ext.importPath });
  return m;
}

/** Emit one snippet's IR. Used by emit_code recursively and by emit_snippet. */
export async function emitSnippet(
  snippet: Snippet,
  options: EmitSnippetOptions = {},
): Promise<Result<EmitSnippetIR, CodegenError>> {
  return DoAsync<EmitSnippetIR, CodegenError>(async function* () {
    const componentsAlias = options.componentsAlias ?? DEFAULT_ALIAS;
    const componentName = pascal(snippet.name || snippet.id);
    const paramNames = new Set(snippet.params.map((p) => p.name));
    const snippetPascalById = buildSnippetPascalMap(options.snippets);
    const extensionsMap = buildExtensionsMap(options.extensions);
    const warnings: string[] = [];
    const ctx = {
      componentsAlias,
      snippetsAlias: options.snippetsAlias,
      snippetPascalById,
      snippets: options.snippets,
      snippetParamNames: paramNames,
      extensions: extensionsMap,
      target: options.target,
      inlineStyle: options.inlineStyle,
      warnings,
      indent: (d: number) => "  ".repeat(d),
    };
    const body = yield* $(emitTree(snippet.tree, ctx));
    const meta = collectMetadata(snippet.tree, options.snippets);
    for (const name of [...meta.unresolvedIcons].sort()) warnings.push(unresolvedIconWarning(name));
    const native = options.target !== undefined || Boolean(options.inlineStyle);
    return {
      id: snippet.id,
      componentName,
      params: snippet.params.map((p) => ({
        name: p.name,
        type: p.type,
        ...(p.default !== undefined ? { default: String(p.default) } : {}),
        ...(p.optional ? { optional: true } : {}),
      })),
      jsx: body,
      componentsToInstall: native ? [] : shadcnInstallTargets(meta.components),
      helpersToMaterialize: native ? [] : helpersToMaterialize(meta.components),
      warnings: [...new Set(warnings)],
    };
  });
}
