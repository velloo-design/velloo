/**
 * emit_code: agent-consumed intermediate representation for a screen.
 *
 * emit_code is no longer a paste-ready file. The
 * agent reads this IR alongside the user's app code and writes the real file
 * in the user's conventions (their import paths, their prettier config, their
 * wrappers). Velloo's job is to be honest about what's in the screen — the
 * JSX shape, the library identifiers used, the snippets it references, the
 * Tailwind classes baked in.
 *
 * What `emit_code` no longer does:
 *   - generate `import { ... } from "..."` blocks (the agent picks paths)
 *   - run biome / prettier (the agent runs the user's formatter)
 *   - write to a file (the agent writes; emit_code is pure)
 *   - diff against an existing file (no target file exists yet)
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
  type Screen,
  type Snippet,
} from "@velloo/schema";
import { resolveLucideJsxName } from "../component-registry.ts";
import type { CodegenError } from "../errors.ts";
import { ImportSet } from "./imports.ts";
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
  /** Typed parameters the snippet declares (name + type, defaults preserved). */
  params: { name: string; type: string; default?: string }[];
  /** JSX body of the snippet, same shape as a screen's `jsx`. */
  jsx: string;
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
  componentsAlias?: string;
  snippetsAlias?: string;
  /** Snippets registry — required if the screen tree contains $snippet instances. */
  snippets?: Map<string, Snippet>;
  /**
   * Extensions registry — folder-global custom components (Sprint Y).
   * Required for emit_code to emit imports for any extension $refs in the
   * tree; without it, references to a registered extension surface as
   * `UnknownComponent`. Pass `Object.entries(config.extensions ?? {})`
   * mapped to importPath-only records.
   */
  extensions?: Record<string, Extension>;
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
): { components: Set<string>; icons: Set<string>; snippetIds: Set<string> } {
  const components = new Set<string>();
  const icons = new Set<string>();
  const snippetIds = new Set<string>();
  function walk(node: Node): void {
    if (isComponentNode(node)) {
      components.add(node.$ref);
      // Icon's `name` prop drives an inline lucide JSX; record the name
      // so the agent imports it. Same resolver as the registry entry —
      // invalid/missing names render <HelpCircle />, which needs an import too.
      if (node.$ref === "Icon") {
        icons.add(resolveLucideJsxName(node.props?.name));
      }
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
  return { components, icons, snippetIds };
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
      imports: new ImportSet(),
      componentsAlias,
      snippetsAlias: options.snippetsAlias,
      snippetPascalById,
      snippets: options.snippets,
      extensions: extensionsMap,
      warnings,
      indent: (d: number) => "  ".repeat(d),
    };
    const body = yield* $(emitTree(screen.tree, ctx));

    const meta = collectMetadata(screen.tree, options.snippets);

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
        }),
      );
      snippetIRs.push(snippetR);
    }

    return {
      screen: { id: screen.id, name: screen.name },
      jsx: body,
      componentsUsed: [...meta.components].sort(),
      iconsUsed: [...meta.icons].sort(),
      snippetsUsed: snippetIRs,
      classesUsed: extractClasses(body),
      warnings: [...new Set(warnings)],
    };
  });
}

export interface EmitSnippetOptions {
  componentsAlias?: string;
  snippetsAlias?: string;
  snippets?: Map<string, Snippet>;
  /** Folder-global extensions (Sprint Y) — same shape as `EmitCodeOptions.extensions`. */
  extensions?: Record<string, Extension>;
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
      imports: new ImportSet(),
      componentsAlias,
      snippetsAlias: options.snippetsAlias,
      snippetPascalById,
      snippets: options.snippets,
      snippetParamNames: paramNames,
      extensions: extensionsMap,
      warnings,
      indent: (d: number) => "  ".repeat(d),
    };
    const body = yield* $(emitTree(snippet.tree, ctx));
    return {
      id: snippet.id,
      componentName,
      params: snippet.params.map((p) => ({
        name: p.name,
        type: p.type,
        ...(p.default !== undefined ? { default: String(p.default) } : {}),
      })),
      jsx: body,
      warnings: [...new Set(warnings)],
    };
  });
}

/** Walk a screen tree and collect snippet ids referenced. */
export function snippetIdsReferenced(screen: Screen): Set<string> {
  const out = new Set<string>();
  walkForSnippets(screen.tree, out);
  return out;
}

function walkForSnippets(node: Node, out: Set<string>): void {
  if (isSnippetInstance(node)) {
    out.add(node.$snippet);
    return;
  }
  if (isComponentNode(node) && node.children) {
    for (const child of node.children) walkForSnippets(child, out);
  }
}
