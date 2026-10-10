import { foldRepeats } from "@velloo/codegen";
import { ELEMENT_TAG } from "@velloo/helpers";
import type { FrameworkAdapter } from "@velloo/provider";
import {
  isComponentNode,
  isSnippetInstance,
  isTextNode,
  type Node,
  type Screen,
} from "@velloo/schema";
import type { MutationContext } from "../mutations/context.ts";
import { providerForScreen, registryForScreen } from "../mutations/lookup.ts";
import { snippetJsxTags } from "./restricted-jsx.ts";

/**
 * A design tree as the JSX `compose` reads — the other half of the round trip.
 *
 * An agent edits text far better than it patches a tree by index path, and it
 * reads JSX far better than the node JSON (which also costs several times the
 * tokens). So a screen, or one subtree of it, can be read as JSX, edited, and
 * written back with `compose { mode: "replace" }`. What the printer emits is
 * held to one rule: composing it again yields the same nodes. The few things
 * JSX has no place for are listed rather than dropped in silence.
 */
export interface PrintedJsx {
  jsx: string;
  /** What the tree holds that this JSX cannot say — lost if the JSX replaces it. */
  notInJsx: string[];
}

interface PrintContext {
  /** What a lowercase tag compiles to, so it can be printed back as the tag. */
  element: string;
  components: Set<string>;
  snippetTag(id: string): string | null;
  repoTag(node: Node): string | null;
  /** Print a run of look-alike siblings as one `.map` over their values. */
  fold: boolean;
  notInJsx: string[];
}

const WIDTH = 100;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (typeof (value as { $ref?: unknown }).$ref === "string" ||
    typeof (value as { $snippet?: unknown }).$snippet === "string");

/**
 * Text as a JSX child: bare where JSX keeps it as written, a string literal
 * otherwise. A space at the edge of a run is content only while a neighbour
 * holds it on the line (`Remote <a>`), so `edge` says which sides are open.
 */
function childText(text: string, edge = { start: true, end: true }): string {
  const plain =
    /^[^{}<>\n]+$/.test(text) &&
    !(edge.start && /^\s/.test(text)) &&
    !(edge.end && /\s$/.test(text));
  return plain ? text : `{${JSON.stringify(text)}}`;
}

function attribute(name: string, value: unknown, ctx: PrintContext, depth: number): string | null {
  if (value === undefined) return null;
  if (value === true) return name;
  if (typeof value === "string") {
    return /["\\\n{}]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  }
  if (isNode(value)) return `${name}={${print(value, ctx, depth + 1).trimStart()}}`;
  return `${name}={${JSON.stringify(value)}}`;
}

function element(
  tag: string,
  attributes: Array<string | null>,
  children: string[] | string | null,
  depth: number,
): string {
  const pad = "  ".repeat(depth);
  const attrs = attributes.filter((entry): entry is string => entry !== null);
  const flat = [tag, ...attrs].join(" ");
  const open =
    pad.length + flat.length + 2 <= WIDTH || attrs.length === 0
      ? `${pad}<${flat}`
      : `${pad}<${tag}\n${attrs.map((entry) => `${pad}  ${entry}`).join("\n")}\n${pad}`;
  if (children === null || children.length === 0)
    return `${open}${open.includes("\n") ? "" : " "}/>`;
  if (typeof children === "string") {
    const line = `${open}>${children}</${tag}>`;
    if (!open.includes("\n") && line.length <= WIDTH) return line;
    return `${open}>\n${pad}  ${children}\n${pad}</${tag}>`;
  }
  return `${open}>\n${children.join("\n")}\n${pad}</${tag}>`;
}

function print(
  node: Node,
  ctx: PrintContext,
  depth: number,
  edge = { start: true, end: true },
): string {
  const pad = "  ".repeat(depth);
  if (isTextNode(node)) return `${pad}${childText(node.$text, edge)}`;

  if (isSnippetInstance(node)) {
    const tag = ctx.snippetTag(node.$snippet);
    if (tag === null) {
      ctx.notInJsx.push(
        `the snippet instance "${node.$snippet}" (its tag is taken by a component)`,
      );
      return `${pad}{/* snippet ${node.$snippet} */}`;
    }
    if (node.$overrides && Object.keys(node.$overrides).length > 0) {
      ctx.notInJsx.push(`<${tag}${node.$id ? ` @${node.$id}` : ""}>'s per-instance overrides`);
    }
    const { children, ...args } = node.args ?? {};
    const attrs = [
      node.$id ? attribute("vellooId", node.$id, ctx, depth) : null,
      ...Object.entries(args).map(([name, value]) => attribute(name, value, ctx, depth)),
      node.$extraClassName ? attribute("className", node.$extraClassName, ctx, depth) : null,
    ];
    if (typeof children === "string") return element(tag, attrs, childText(children), depth);
    if (isNode(children)) return element(tag, attrs, [print(children, ctx, depth + 1)], depth);
    return element(tag, attrs, null, depth);
  }

  if (!isComponentNode(node)) {
    ctx.notInJsx.push("a parameter reference (snippet bodies only)");
    return `${pad}{/* param */}`;
  }

  const props = { ...(node.props ?? {}) };
  let tag = node.$ref;
  if (node.$repo) {
    tag = ctx.repoTag(node) ?? node.$ref;
  } else if (
    node.$ref === ctx.element &&
    typeof props.as === "string" &&
    ELEMENT_TAG.test(props.as) &&
    // A lowercase tag a component already owns would read back as that component.
    !ctx.components.has(props.as)
  ) {
    tag = props.as;
    delete props.as;
  }
  if (node.$emitAs) {
    ctx.notInJsx.push(
      `<${tag}${node.$id ? ` @${node.$id}` : ""}>'s $emitAs (${node.$emitAs.name})`,
    );
  }
  const text = typeof props.children === "string" ? props.children : null;
  if (text !== null) delete props.children;
  const attrs = [
    node.$id ? attribute("vellooId", node.$id, ctx, depth) : null,
    ...Object.entries(props).map(([name, value]) => attribute(name, value, ctx, depth)),
  ];
  const children = node.children ?? [];
  if (children.length === 0)
    return element(tag, attrs, text === null ? null : childText(text), depth);
  // Text and its neighbours stay on one line: a line break between them is
  // whitespace JSX would drop or keep by rules nobody wants to reason about.
  if (children.some(isTextNode)) {
    const inline = children
      .map((child, at) =>
        print(child, ctx, 0, { start: at === 0, end: at === children.length - 1 }),
      )
      .join("");
    return element(tag, attrs, inline, depth);
  }
  const parts = children.map((child) => print(child, ctx, depth + 1));
  return element(
    tag,
    attrs,
    ctx.fold ? foldRepeats(parts, "  ".repeat(depth + 1), "  ") : parts,
    depth,
  );
}

/**
 * Print `node` (a screen's tree or a subtree of it) as JSX `compose` reads back
 * to the same nodes. With `fold`, a run of look-alike siblings is one `.map`
 * over their values — shorter to read, and one template to edit for all of
 * them; `compose` evaluates it back into the same siblings.
 */
export async function printJsx(
  ctx: MutationContext,
  screen: Screen,
  node: Node,
  options: { fold?: boolean } = {},
): Promise<PrintedJsx> {
  const provider = providerForScreen(ctx, screen) as FrameworkAdapter;
  const components = new Set(Object.keys(registryForScreen(ctx, screen)));
  const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
  const tags = new Map<string, string>();
  for (const snippet of ctx.folder.snippets.values()) {
    const [tag] = snippetJsxTags(snippet);
    if (tag && !components.has(tag)) tags.set(snippet.id, tag);
  }
  const context: PrintContext = {
    element: provider.elementComponent ?? "Box",
    components,
    snippetTag: (id) => tags.get(id) ?? null,
    repoTag: (repoNode) => {
      const identity = isComponentNode(repoNode) ? repoNode.$repo : undefined;
      if (!identity || !catalog) return null;
      const key = `${identity.importPath}#${identity.exportName}${identity.member ? `.${identity.member}` : ""}`;
      return catalog.byKey.get(key)?.id ?? null;
    },
    fold: options.fold === true,
    notInJsx: [],
  };
  const jsx = print(node, context, 0);
  return { jsx, notInJsx: [...new Set(context.notInJsx)] };
}
