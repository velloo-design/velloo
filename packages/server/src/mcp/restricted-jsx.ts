import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { ELEMENT_TAG } from "@velloo/helpers";
import { type ComponentProvider, type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import type {
  ComponentNode,
  Node,
  RepoComponentRef,
  Screen,
  Snippet,
  SnippetInstance,
} from "@velloo/schema";
import { styleObjectFromCss } from "@velloo/schema";
import { resolveInHost } from "../host-resolve.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { MutationContext } from "../mutations/context.ts";
import { nearestRefs } from "../mutations/errors.ts";
import { providerForScreen, registryForScreen } from "../mutations/lookup.ts";
import { isExecutableReactAttribute } from "../mutations/snippet-params.ts";
import type { RepoCatalog } from "../repo/catalog.ts";
import {
  ElementValue,
  type ModuleLoader,
  readJsxSource,
  type SourceAttribute,
  type SourceElement,
  SourceFailure,
  type SourceText,
} from "./jsx-source.ts";

export interface JsxIssue {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export type CompileJsxResult =
  | { ok: true; node: Node; notes: string[] }
  | { ok: false; issues: JsxIssue[] };

type Attribute = SourceAttribute;
type Element = SourceElement;
type TextNode = SourceText;

function issueAt(source: string, offset: number, message: string): JsxIssue {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    message,
    offset,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/**
 * A JSX text child as React receives it (Babel's `cleanJSXElementLiteralChild`):
 * lines are trimmed where they meet a line break, blank lines vanish, and the
 * rest join with one space. Whitespace on a single line is content.
 */
function jsxText(node: TextNode): string {
  if (node.literal) return node.text;
  const lines = node.text.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i] ?? "")) lastNonEmpty = i;
  }
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] ?? "").replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^ +/, "");
    if (i !== lines.length - 1) line = line.replace(/ +$/, "");
    if (!line) continue;
    out += i === lastNonEmpty ? line : `${line} `;
  }
  return out;
}

/** Elements whose own box is inline: whitespace between two of them is a word space. */
const INLINE_TAG =
  /^(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|label|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)$/;

/**
 * What an element holds, as the design tree stores it: text alone (which
 * becomes `props.children`), or its children in order — elements, and the text
 * runs between them, each of which becomes a text node.
 *
 * `<Button><Icon />Rewards</Button>` and `<li>Remote <a>Apply</a></li>` are how
 * every React codebase writes text beside an element. A text run is kept as
 * text rather than wrapped in a `<span>` of Velloo's making, so the design's
 * DOM is the app's and no selector in its stylesheet (`.jobs li span`) can
 * tell them apart.
 *
 * JSX's own rule decides which whitespace is formatting (see `jsxText`). What
 * it keeps between two elements on one line is kept here only where it can be
 * a word space — the author spelled it (`{" "}`), the parent has text of its
 * own, or a neighbour is an inline element. Between two blocks or components
 * it is how the line was typed, and a tree addressed by child index is better
 * off without a node nobody can see.
 */
function contentOf(children: Array<Element | TextNode>): {
  text?: string;
  elements: Element[];
  mixed: Array<Element | string>;
} {
  const elements = children.filter((child): child is Element => "tag" in child);
  if (elements.length === 0) {
    const text = children.map((child) => jsxText(child as TextNode)).join("");
    return { ...(text ? { text } : {}), elements, mixed: [] };
  }
  // By now `<span>` is the element component with `as="span"`.
  const inline = (child: Element | TextNode | undefined): boolean => {
    if (child === undefined || !("tag" in child)) return false;
    const as = child.attributes.find((attr) => attr.name === "as")?.value;
    const tag = typeof as === "string" ? as : child.tag;
    return tag !== null && INLINE_TAG.test(tag);
  };
  const hasWords = children.some((child) => !("tag" in child) && jsxText(child).trim() !== "");
  const mixed: Array<Element | string> = [];
  children.forEach((child, at) => {
    if ("tag" in child) {
      mixed.push(child);
      return;
    }
    const text = jsxText(child);
    if (text === "") return;
    const wordSpace =
      text.trim() !== "" ||
      child.literal === true ||
      (at > 0 &&
        at < children.length - 1 &&
        (hasWords || inline(children[at - 1]) || inline(children[at + 1])));
    if (!wordSpace) return;
    const last = mixed.at(-1);
    // `Book{" "}now` is three pieces of one run.
    if (typeof last === "string") mixed[mixed.length - 1] = last + text;
    else mixed.push(text);
  });
  return { elements, mixed: mixed.some((item) => typeof item === "string") ? mixed : [] };
}

export function snippetJsxTags(snippet: Snippet): string[] {
  const pascal = (value: string): string =>
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join("");
  return [...new Set([snippet.id, snippet.name].map(pascal).filter(Boolean))];
}

interface CompileContext {
  source: string;
  components: Set<string>;
  catalog: Set<string>;
  snippets: Map<string, Snippet[]>;
  /** Repository components by catalog id — the app's own and its packages'. */
  repo: Map<string, { name: string; identity: RepoComponentRef; styleProps?: string[] }>;
  /** The screen styles with Tailwind classes, so a string `style` is a class list. */
  tailwind: boolean;
  /** What a lowercase HTML tag compiles to (the adapter's `elementComponent`). */
  element: string;
}

type CompiledNode = { ok: true; node: Node } | { ok: false; issues: JsxIssue[] };

function compileElement(element: Element, ctx: CompileContext): CompiledNode {
  if (element.tag === null) {
    const meaningful = element.children.filter(
      (child) => "tag" in child || child.text.trim().length > 0,
    );
    if (meaningful.length !== 1 || !("tag" in (meaningful[0] ?? {}))) {
      const roots = meaningful.filter((child) => "tag" in child).length;
      return {
        ok: false,
        issues: [
          issueAt(
            ctx.source,
            element.offset,
            roots > 1
              ? `A fragment must contain exactly one root element; this one has ${roots}. Wrap them in a single parent (<Box>…</Box>), or send one call per root.`
              : "A fragment must contain exactly one root element. Wrap the content in a single element (<Box>…</Box>) — bare text is not a root.",
          ),
        ],
      };
    }
    return compileElement(meaningful[0] as Element, ctx);
  }

  const attrs = new Map<string, Attribute>();
  for (const attr of element.attributes) {
    if (attrs.has(attr.name)) {
      return {
        ok: false,
        issues: [issueAt(ctx.source, attr.offset, `Duplicate attribute "${attr.name}"`)],
      };
    }
    if (isExecutableReactAttribute(attr.name)) {
      return {
        ok: false,
        issues: [
          issueAt(
            ctx.source,
            attr.offset,
            `Executable React attribute "${attr.name}" is not allowed in static design JSX`,
          ),
        ],
      };
    }
    attrs.set(attr.name, attr);
  }
  const stableId = attrs.get("vellooId")?.value;
  if (stableId !== undefined && typeof stableId !== "string") {
    return {
      ok: false,
      issues: [
        issueAt(
          ctx.source,
          attrs.get("vellooId")?.offset ?? element.offset,
          "vellooId must be a string",
        ),
      ],
    };
  }
  attrs.delete("vellooId");

  const snippetMatches = ctx.snippets.get(element.tag) ?? [];
  const repoEntry = ctx.components.has(element.tag) ? undefined : ctx.repo.get(element.tag);
  const isComponent = ctx.components.has(element.tag) || repoEntry !== undefined;
  if (isComponent && snippetMatches.length > 0) {
    return {
      ok: false,
      issues: [
        issueAt(
          ctx.source,
          element.offset,
          `"${element.tag}" is ambiguous: both a component and a snippet use this tag`,
        ),
      ],
    };
  }

  const { text, elements, mixed } = contentOf(element.children);

  // A slot prop's element compiles like a child: a component, snippet or text.
  // A node written as a JSON literal instead is held to the same namespace, so
  // an unresolvable one fails here rather than taking the screen's render down.
  for (const attr of attrs.values()) {
    if (attr.value instanceof ElementValue) {
      const compiled = compileElement(attr.value.element, ctx);
      if (!compiled.ok) return compiled;
      attr.value = compiled.node;
      continue;
    }
    // Several elements in one slot (`actions={[<Save />, <Cancel />]}`): a list of nodes.
    if (Array.isArray(attr.value) && attr.value.some((item) => item instanceof ElementValue)) {
      const nodes: unknown[] = [];
      for (const item of attr.value) {
        if (!(item instanceof ElementValue)) {
          nodes.push(item);
          continue;
        }
        const compiled = compileElement(item.element, ctx);
        if (!compiled.ok) return compiled;
        nodes.push(compiled.node);
      }
      attr.value = nodes;
      continue;
    }
    const resolved = resolveLiteralNodes(attr.value, ctx);
    if (typeof resolved === "string") {
      return { ok: false, issues: [issueAt(ctx.source, attr.offset, resolved)] };
    }
    attr.value = resolved.value;
  }

  if (isComponent) {
    const props = Object.fromEntries([...attrs].map(([name, attr]) => [name, attr.value]));
    // `update_props { style: "flex gap-4" }` is how the instructions teach
    // styling, and agents carry the habit into JSX. A string there is the
    // screen's style channel speaking, not React's `style` object. A
    // repository component styles through the props it declares, so the same
    // holds for one that takes `className` and no `style` of its own.
    const classStyled =
      repoEntry === undefined ||
      (repoEntry.styleProps?.includes("className") === true &&
        !repoEntry.styleProps.includes("style"));
    if (typeof props.style === "string" && classStyled) {
      if (ctx.tailwind) {
        props.className = [props.className, props.style]
          .filter((c) => typeof c === "string" && c.trim() !== "")
          .join(" ");
        delete props.style;
      } else {
        // HTML's own `style="background: …; color: …"` is what an agent
        // copying a server-rendered page writes; on an inline-style channel it
        // means exactly the object React wants.
        const declared = styleObjectFromCss(props.style);
        if (!declared) {
          return {
            ok: false,
            issues: [
              issueAt(
                ctx.source,
                attrs.get("style")?.offset ?? element.offset,
                "`style` takes an object or CSS declarations on this folder's style channel, not a class string",
              ),
            ],
          };
        }
        props.style = declared;
      }
    }
    if (text) {
      if ("children" in props) {
        return {
          ok: false,
          issues: [
            issueAt(ctx.source, element.offset, "Specify children as text or a prop, not both"),
          ],
        };
      }
      props.children = text;
    }
    const children: Node[] = [];
    for (const child of mixed.length > 0 ? mixed : elements) {
      if (typeof child === "string") {
        children.push({ $text: child });
        continue;
      }
      const compiled = compileElement(child, ctx);
      if (!compiled.ok) return compiled;
      children.push(compiled.node);
    }
    const node: ComponentNode = {
      $ref: repoEntry?.name ?? element.tag,
      ...(repoEntry ? { $repo: repoEntry.identity } : {}),
      ...(stableId ? { $id: stableId } : {}),
      ...(Object.keys(props).length > 0 ? { props } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
    return { ok: true, node };
  }

  if (snippetMatches.length === 1) {
    const snippet = snippetMatches[0] as Snippet;
    const params = new Map(snippet.params.map((param) => [param.name, param]));
    const args: Record<string, unknown> = {};
    let extraClassName: string | undefined;
    for (const [name, attr] of attrs) {
      if (name === "className" && !params.has(name)) {
        if (typeof attr.value !== "string") {
          return {
            ok: false,
            issues: [issueAt(ctx.source, attr.offset, "A snippet className must be a string")],
          };
        }
        extraClassName = attr.value;
      } else if (!params.has(name)) {
        return {
          ok: false,
          issues: [
            issueAt(ctx.source, attr.offset, `Unknown prop "${name}" for snippet ${element.tag}`),
          ],
        };
      } else {
        args[name] = attr.value;
      }
    }
    if (text || elements.length > 0) {
      const childParam = params.get("children");
      if (!childParam) {
        return {
          ok: false,
          issues: [
            issueAt(
              ctx.source,
              element.offset,
              `Snippet ${element.tag} declares no children param`,
            ),
          ],
        };
      }
      if (text) args.children = text;
      else {
        if (childParam.type !== "node" || elements.length !== 1 || mixed.length > 0) {
          return {
            ok: false,
            issues: [
              issueAt(
                ctx.source,
                element.offset,
                `Snippet ${element.tag} needs one node child for its children param`,
              ),
            ],
          };
        }
        const compiled = compileElement(elements[0] as Element, ctx);
        if (!compiled.ok) return compiled;
        args.children = compiled.node;
      }
    }
    const missing = snippet.params
      .filter((param) => !param.optional && param.default === undefined && !(param.name in args))
      .map((param) => param.name);
    if (missing.length > 0) {
      return {
        ok: false,
        issues: [
          issueAt(
            ctx.source,
            element.offset,
            `Snippet ${element.tag} is missing required props: ${missing.join(", ")}`,
          ),
        ],
      };
    }
    const node: SnippetInstance = {
      $snippet: snippet.id,
      ...(stableId ? { $id: stableId } : {}),
      ...(extraClassName ? { $extraClassName: extraClassName } : {}),
      ...(Object.keys(args).length > 0 ? { args } : {}),
    };
    return { ok: true, node };
  }

  const allNames = [...ctx.components, ...ctx.snippets.keys(), ...ctx.repo.keys()];
  const suggestions = nearestRefs(element.tag, allNames);
  const catalogOnly = ctx.catalog.has(element.tag);
  return {
    ok: false,
    issues: [
      issueAt(
        ctx.source,
        element.offset,
        catalogOnly
          ? `Component "${element.tag}" is known to the library but unavailable in its design renderer; refresh the provider snapshot`
          : ELEMENT_TAG.test(element.tag)
            ? `<${element.tag}> is an HTML element, which compiles to ${ctx.element} — and this screen's library has no ${ctx.element}. Use the library's own components instead${suggestions.length ? ` (${suggestions.join(", ")}?)` : ""}.`
            : `Unknown component or snippet "${element.tag}"${suggestions.length ? `; did you mean ${suggestions.join(", ")}?` : ""}`,
      ),
    ],
  };
}

/**
 * A prop value that is a literal node (`{"$ref": "IconSearch"}`), or an array
 * of them: attach the repo identity its name resolves to, or say why it can't
 * render. Anything else passes through untouched.
 */
function resolveLiteralNodes(value: unknown, ctx: CompileContext): { value: unknown } | string {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const resolved = resolveLiteralNodes(item, ctx);
      if (typeof resolved === "string") return resolved;
      out.push(resolved.value);
    }
    return { value: out };
  }
  if (!value || typeof value !== "object") return { value };
  const node = value as Record<string, unknown>;
  const ref = node.$ref;
  if (typeof ref !== "string" || node.$repo !== undefined || ctx.components.has(ref)) {
    return { value };
  }
  const entry = ctx.repo.get(ref);
  if (entry) return { value: { ...node, $ref: entry.name, $repo: entry.identity } };
  const suggestions = nearestRefs(ref, [...ctx.components, ...ctx.repo.keys()]);
  return `Unknown component "${ref}" in a prop value${suggestions.length ? `; did you mean ${suggestions.join(", ")}?` : ""} — or pass it as an element: prop={<${suggestions[0] ?? ref} />}`;
}

const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/;
const MAX_MODULE_BYTES = 512 * 1024;

/** The host app's root, as a real path — what a source's files are held inside. */
export function hostRootOf(ctx: MutationContext): string {
  const root = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/**
 * A file of the host app, or null: inside its root, outside `node_modules`,
 * a source file of a size worth reading. Shared by the page `compose` is
 * pointed at and the modules that page imports.
 */
export function readHostSource(
  hostRoot: string,
  path: string,
): { file: string; source: string } | null {
  let file: string;
  try {
    file = realpathSync(path);
  } catch {
    return null;
  }
  if (!file.startsWith(hostRoot + sep) || file.includes(`${sep}node_modules${sep}`)) return null;
  if (!MODULE_EXTENSION.test(file)) return null;
  try {
    if (statSync(file).size > MAX_MODULE_BYTES) return null;
    const source = readFileSync(file, "utf8");
    // A JSON module is its value, default-exported.
    return { file, source: file.endsWith(".json") ? `export default ${source}` : source };
  } catch {
    return null;
  }
}

/** Resolves a source's imports to the app's own files, the way the app's bundler would. */
function hostModules(hostRoot: string): ModuleLoader {
  return {
    load(specifier, from) {
      try {
        return readHostSource(hostRoot, resolveInHost(specifier, from ? dirname(from) : hostRoot));
      } catch {
        return null;
      }
    },
  };
}

/**
 * The `layout` files a Next app-router page renders inside, innermost first:
 * every `layout.*` from the page's folder up to the `app` directory. A page
 * file on its own is the page without its site header, so a page read from the
 * app is composed the way its route shows it.
 */
function layoutsFor(
  hostRoot: string,
  file: string,
): { file: string; label: string; source: string }[] {
  if (!/^page\.[jt]sx?$/.test(basename(file))) return [];
  const out: { file: string; label: string; source: string }[] = [];
  for (let dir = dirname(file); dir.startsWith(hostRoot + sep); dir = dirname(dir)) {
    for (const extension of ["tsx", "jsx", "ts", "js"]) {
      const layout = readHostSource(hostRoot, join(dir, `layout.${extension}`));
      if (!layout) continue;
      out.push({ ...layout, label: relative(hostRoot, layout.file) });
      break;
    }
    if (basename(dir) === "app") return out;
  }
  // No `app` directory above it: not an app-router page, whatever it is called.
  return [];
}

export interface CompileOptions {
  /** The app file the source was read from, when `compose` was pointed at one. */
  file?: string;
}

/** Parse and compile non-executing JSX against one screen's live namespace. */
export async function compileRestrictedJsx(
  ctx: MutationContext,
  screen: Screen,
  source: string,
  options: CompileOptions = {},
): Promise<CompileJsxResult> {
  const prepared = await prepareCompile(ctx, screen, source, true, options);
  if (!prepared.ok) return prepared;
  const { root, context } = prepared;
  // A page whose markup is a fragment of several elements — a header, a main
  // and a footer, as a layout's body often is — where a screen has one root:
  // they go in a plain element, and the result says so.
  const several =
    root.tag === null &&
    root.children.filter((child) => "tag" in child).length > 1 &&
    root.children.every((child) => "tag" in child || child.text.trim() === "") &&
    context.components.has(context.element);
  const compiled = compileElement(
    several
      ? {
          tag: context.element,
          attributes: [{ name: "as", value: "div", offset: root.offset }],
          children: root.children,
          offset: root.offset,
        }
      : root,
    context,
  );
  if (!compiled.ok) return compiled;
  const notes = several
    ? [
        ...prepared.notes,
        "The source has several root elements and a screen has one: they were placed in a plain <div>.",
      ]
    : prepared.notes;
  return { ...compiled, notes };
}

/**
 * Every root of a fragment, compiled — for an append that adds several
 * siblings at once. Building a table meant one compose per row: a fragment
 * of rows was refused ("exactly one root"), and wrapping them in a Box would
 * put a div between the table body and its rows.
 */
export async function compileRestrictedJsxRoots(
  ctx: MutationContext,
  screen: Screen,
  source: string,
  options: CompileOptions = {},
): Promise<{ ok: true; nodes: Node[]; notes: string[] } | { ok: false; issues: JsxIssue[] }> {
  const prepared = await prepareCompile(ctx, screen, source, true, options);
  if (!prepared.ok) return prepared;
  const { root, context, notes } = prepared;
  if (root.tag !== null) {
    const single = compileElement(root, context);
    return single.ok ? { ok: true, nodes: [single.node], notes } : single;
  }
  const roots: Element[] = [];
  for (const child of root.children) {
    if ("tag" in child) roots.push(child);
    else if (child.text.trim().length > 0) {
      return {
        ok: false,
        issues: [
          issueAt(
            source,
            child.offset,
            "Bare text is not a root. Wrap it in an element (<Text>…</Text>).",
          ),
        ],
      };
    }
  }
  const nodes: Node[] = [];
  for (const element of roots) {
    const compiled = compileElement(element, context);
    if (!compiled.ok) return compiled;
    nodes.push(compiled.node);
  }
  return nodes.length > 0
    ? { ok: true, nodes, notes }
    : { ok: false, issues: [issueAt(source, 0, "The fragment has no elements to add.")] };
}

async function prepareCompile(
  ctx: MutationContext,
  screen: Screen,
  source: string,
  siblings = false,
  options: CompileOptions = {},
): Promise<
  | { ok: true; root: Element; context: CompileContext; notes: string[] }
  | { ok: false; issues: JsxIssue[] }
> {
  let root: Element;
  let notes: string[];
  try {
    ({ root, notes } = readJsxSource(source, {
      siblings,
      modules: hostModules(hostRootOf(ctx)),
      ...(options.file !== undefined
        ? { file: options.file, layouts: layoutsFor(hostRootOf(ctx), options.file) }
        : {}),
    }));
  } catch (error) {
    if (error instanceof SourceFailure) {
      return { ok: false, issues: [issueAt(source, error.offset, error.message)] };
    }
    throw error;
  }

  const registry = registryForScreen(ctx, screen);
  const provider = providerForScreen(ctx, screen) as ComponentProvider;
  const manifest = await provider.loadManifest().catch(() => []);
  const snippets = new Map<string, Snippet[]>();
  for (const snippet of ctx.folder.snippets.values()) {
    for (const tag of snippetJsxTags(snippet)) {
      const values = snippets.get(tag) ?? [];
      values.push(snippet);
      snippets.set(tag, values);
    }
  }
  // A failed catalog read is remembered, not swallowed: an app tag it would
  // have resolved must not compile to a bare `$ref` that no registry holds.
  let repoCatalog: RepoCatalog | null = null;
  let catalogFailure: string | null = null;
  if (ctx.repo) {
    try {
      repoCatalog = await ctx.repo.catalog();
    } catch (error) {
      catalogFailure = error instanceof Error ? error.message : String(error);
    }
  }
  const components = new Set(Object.keys(registry));
  const element = (provider as FrameworkAdapter).elementComponent ?? "Box";
  lowerIntrinsics(root, components, element);
  // By `byId`, not by `entries`: it also answers a redundant qualifier.
  const repo = new Map(
    [...(repoCatalog?.byId ?? [])].map(([id, entry]) => [
      id,
      {
        name: entry.name,
        identity: entry.proxy ? { ...entry.identity, proxy: entry.proxy } : entry.identity,
        styleProps: entry.styleProps,
      },
    ]),
  );
  // A tag nothing claims may still be an export of a package the app renders
  // from (an icon it picks from data); ask before calling it unknown.
  if (ctx.repo) {
    for (const tag of tagsIn(root)) {
      if (components.has(tag) || snippets.has(tag) || repo.has(tag)) continue;
      const entry = await ctx.repo.resolveName(tag).catch(() => null);
      if (entry)
        repo.set(tag, { name: entry.name, identity: entry.identity, styleProps: entry.styleProps });
    }
  }
  if (catalogFailure !== null) {
    const unresolved = [...tagsIn(root)].filter(
      (tag) => !components.has(tag) && !snippets.has(tag) && !repo.has(tag),
    );
    if (unresolved.length > 0) {
      return {
        ok: false,
        issues: [
          issueAt(
            source,
            0,
            `the app's component catalog could not be read (${catalogFailure}), so ${unresolved.map((tag) => `<${tag}>`).join(", ")} ` +
              "could not be checked against the app's own components. Nothing was written — retry, and if it " +
              "persists check the host app path in .design/config.json and that the app's components build.",
          ),
        ],
      };
    }
  }
  return {
    ok: true,
    root,
    notes,
    context: {
      source,
      components,
      catalog: new Set(manifest.map((descriptor) => descriptor.id)),
      snippets,
      repo,
      tailwind:
        styleChannelOf(provider, ctx.folder.config.styling?.framework).kind ===
        "tailwind-classname",
      element,
    },
  };
}

/**
 * `<input>`, `<span>`, `<svg>`, `<linearGradient>` — a tag that starts
 * lowercase is an element, and agents write them the way every React codebase
 * does. The adapter's element
 * component (`Box`, or `Html` for a server-rendered app) renders any element
 * through `as` and codegen lowers it back, so `<span …>` becomes
 * `<Box as="span" …>` instead of "Unknown component span".
 */
function lowerIntrinsics(element: Element, components: Set<string>, target: string): void {
  if (element.tag !== null && ELEMENT_TAG.test(element.tag) && components.has(target)) {
    if (!element.attributes.some((attr) => attr.name === "as")) {
      element.attributes.unshift({ name: "as", value: element.tag, offset: element.offset });
    }
    element.tag = target;
  }
  for (const attr of element.attributes) {
    if (attr.value instanceof ElementValue) lowerIntrinsics(attr.value.element, components, target);
  }
  for (const child of element.children) {
    if ("tag" in child) lowerIntrinsics(child, components, target);
  }
}

/** Every tag an element tree names: nested, passed as a prop, or a literal `$ref`. */
function tagsIn(root: Element): Set<string> {
  const tags = new Set<string>();
  const literal = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(literal);
    else if (value && typeof value === "object") {
      const ref = (value as { $ref?: unknown }).$ref;
      if (typeof ref === "string") tags.add(ref);
    }
  };
  const visit = (element: Element): void => {
    if (element.tag) tags.add(element.tag);
    for (const attr of element.attributes) {
      if (attr.value instanceof ElementValue) visit(attr.value.element);
      else literal(attr.value);
    }
    for (const child of element.children) if ("attributes" in child) visit(child);
  };
  visit(root);
  return tags;
}
