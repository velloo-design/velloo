import { type NodeIdentityContext, resolveNodeIdentity } from "@velloo/provider";
import { err, ok, type Result } from "@velloo/result";
import {
  applySnippetExtraClassName,
  applySnippetOverrides,
  type ComponentNode,
  type EmitAsNode,
  type Extension,
  isComponentNode,
  isNode,
  isSnippetInstance,
  type Node,
  type ParamRef,
  type RepoNode,
  repoImportIssue,
  resolveSnippetArgs,
  type Snippet,
  type SnippetInstance,
  substituteSnippetParams,
} from "@velloo/schema";
import { type CodegenError, unknownComponent } from "../errors.ts";
import { sanitizeEmittedProps, vellooPrimitiveTarget } from "../velloo-primitives.ts";
import { mergeClasses } from "./classes.ts";
import { isDomProp } from "./dom-props.ts";
import { dynamicIconName } from "./dynamic-icon.ts";
import { serializeIfExpr, serializeProp, serializeTextChild } from "./props.ts";
import type { CodegenTarget, Emit } from "./target.ts";

/**
 * A JSX component/tag name must be a plain identifier (dotted member paths
 * allowed for `Namespace.Sub`). A design-JSON author controls `$ref` and
 * `$emitAs.name`, which are emitted verbatim as the opening/closing tag and as
 * an import binding — a value like `div onLoad={fetch(...)}` or one carrying a
 * `}`/`"` would break out of the tag or the import statement, so reject it.
 */
const VALID_JSX_NAME = /^[A-Za-z_$][\w$.]*$/;

/**
 * A module specifier we're willing to emit verbatim into `import … from "…"`.
 * Real bare/scoped packages, path aliases, and relative paths use only this
 * conservative charset; anything else (quotes, spaces, semicolons, newlines)
 * could break out of the import string, so reject it.
 */
const VALID_IMPORT_SPECIFIER = /^[\w@./~-]+$/;

export interface EmitContext {
  componentsAlias: string;
  /** Where snippet React components live. Defaults to `<componentsAlias>/../snippets`. */
  snippetsAlias?: string | undefined;
  /** PascalCase names for each snippet id. Used to emit `<FeatureCard />` from `$snippet: "feature-card"`. */
  snippetPascalById?: Map<string, string> | undefined;
  /** Snippet definitions — required to inline instances carrying `$overrides`. */
  snippets?: Map<string, Snippet> | undefined;
  /** Set when emitting *inside* a snippet body: `$param` nodes become `{name}`. */
  snippetParamNames?: Set<string> | undefined;
  /**
   * Folder-scoped extensions, keyed by the component id each registers. One
   * emits as `import { <id> } from <importPath>` verbatim — no alias rewrite —
   * so the agent's emit lands in the user's app at the path they declared.
   */
  extensions?: Readonly<Record<string, Extension>> | undefined;
  /**
   * The screen framework's codegen target — shadcn's, MUI's, antd's. It owns the
   * library's own component ids; names it doesn't own fall through to the velloo
   * primitives. Absent ⇒ only the velloo primitives resolve.
   */
  target?: CodegenTarget | undefined;
  /**
   * The screen emits on the inline-`style` channel: the velloo primitives lower
   * to plain HTML with `style` defaults rather than Tailwind classes. Set from
   * the screen's resolved style channel.
   */
  inlineStyle?: boolean | undefined;
  /**
   * Non-fatal emit caveats accumulated during the walk (e.g. an Icon whose
   * `name` is a dynamic param, which can't survive lowering — see
   * renderComponent). Surfaced on the emit result so the agent self-corrects
   * instead of silently shipping the fallback.
   */
  warnings?: string[] | undefined;
  /** 2-space indentation, baked once. */
  indent(depth: number): string;
}

/** Render a node tree (root) as a single JSX string. */
export function emitTree(root: Node, ctx: EmitContext): Result<string, CodegenError> {
  return renderNode(root, ctx, 0);
}

/**
 * What a library name emits as, resolved down the chain: the screen framework's
 * target first, then the velloo primitives every framework shares. The lookup
 * `resolveNodeIdentity` consults, so the resolver's `component` verdict and the
 * emit `renderComponent` prints are one decision.
 */
function libraryComponent(
  ref: string,
  ctx: Pick<EmitContext, "inlineStyle" | "target">,
): Emit | undefined {
  for (const target of [ctx.target, vellooPrimitiveTarget(Boolean(ctx.inlineStyle))]) {
    const emit = target?.componentFor(ref);
    if (emit) return emit;
  }
  return undefined;
}

/**
 * The resolver context both codegen walks — the emit and the metadata that
 * reports on it — resolve names through, so they cannot disagree about what a
 * name is.
 */
export function emitIdentityContext(
  ctx: Pick<EmitContext, "extensions" | "inlineStyle" | "target">,
): NodeIdentityContext<Emit> {
  return {
    extensions: ctx.extensions,
    library: (ref) => libraryComponent(ref, ctx),
  };
}

function renderNode(node: Node, ctx: EmitContext, depth: number): Result<string, CodegenError> {
  const identity = resolveNodeIdentity(node, emitIdentityContext(ctx));
  switch (identity.kind) {
    case "snippet":
      return renderSnippetInstance(identity.node, ctx, depth);
    case "param":
      return renderParamRef(identity.node, ctx, depth);
    case "invalid":
      return err(unknownComponent(`<unknown node kind>`));
    case "repo":
      return renderRepoComponent(identity.node, ctx, depth);
    case "emit-as":
      return renderEmitAs(identity.node, ctx, depth);
    case "synthetic":
      // Synthetic refs are preview-only — a param slot, a statically-rendered
      // node — and never persisted, so nothing in a tree being emitted can be
      // one. Reported as unknown rather than invented as a JSX tag.
      return err(unknownComponent(identity.ref));
    case "unresolved":
      return err(unknownComponent(identity.ref));
    case "extension": {
      const emit = extensionEmit(identity.ref, identity.extension);
      if (!emit) return err(unknownComponent(identity.ref));
      return renderComponent(identity.node, emit, ctx, depth);
    }
    case "component":
      return renderComponent(identity.node, identity.entry, ctx, depth);
  }
}

/**
 * An extension emits as its own id, imported from the path the user declared —
 * so it needs no provisioning plan of its own. Both halves are validated here
 * because both are author-controlled and land verbatim in the agent's code.
 */
function extensionEmit(ref: string, extension: Extension): Emit | null {
  if (!VALID_JSX_NAME.test(ref) || !VALID_IMPORT_SPECIFIER.test(extension.importPath)) {
    return null;
  }
  return { kind: "component", jsxName: ref };
}

/**
 * Host-component facade: the canvas rendered this node's approximation subtree,
 * but codegen emits the app's real component import instead (identity preserved
 * through scan → design → emit). Bare `<Name />` — the data-bound props live in
 * the app, not the design. See ComponentNode.$emitAs.
 */
function renderEmitAs(
  node: EmitAsNode,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  const { name, importPath } = node.$emitAs;
  if (!VALID_JSX_NAME.test(name) || !VALID_IMPORT_SPECIFIER.test(importPath)) {
    return err(unknownComponent(`$emitAs:${name}`));
  }
  return ok(`${ctx.indent(depth)}<${name} />`);
}

function renderSnippetInstance(
  node: SnippetInstance,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  // Instances carrying interior overrides can't emit as the shared
  // component — a React component has one body. Inline the resolved
  // subtree instead: honest JSX for exactly what this instance renders.
  if (node.$overrides && Object.keys(node.$overrides).length > 0) {
    const snippet = ctx.snippets?.get(node.$snippet);
    if (!snippet) return err(unknownComponent(`@${node.$snippet}`));
    const { args, missing } = resolveSnippetArgs(snippet, node.args ?? {});
    if (missing.length > 0) return err(unknownComponent(`$param:${missing[0]}`));
    const substituted = substituteSnippetParams(snippet.tree, args);
    if (substituted.missing.length > 0) {
      return err(unknownComponent(`$param:${substituted.missing[0]}`));
    }
    let body = applySnippetOverrides(substituted.value as Node, node.$overrides);
    const extra = node.$extraClassName?.trim();
    if (extra) body = applySnippetExtraClassName(body, extra);
    // Body values are concrete now — emit outside any snippet-param scope.
    const inlineCtx: EmitContext = { ...ctx, snippetParamNames: undefined };
    return renderNode(body, inlineCtx, depth);
  }

  const pascal = ctx.snippetPascalById?.get(node.$snippet);
  if (!pascal) {
    return err(unknownComponent(`@${node.$snippet}`));
  }
  const attrParts: string[] = [];
  for (const [name, value] of Object.entries(node.args ?? {})) {
    // A node argument (an icon for a `node` param) is JSX, not an object literal.
    if (isComponentNode(value as Node) || isSnippetInstance(value as Node)) {
      const slot = nodeAttr(name, value as Node, ctx, depth);
      if (!slot.ok) return slot;
      attrParts.push(slot.value);
      continue;
    }
    const serialized = serializeProp(name, value, ctx.snippetParamNames);
    if (serialized !== null) attrParts.push(serialized);
  }
  // $extraClassName threads through as className on the React component — the
  // snippet's emitted component merges it onto its root via cn().
  if (node.$extraClassName && node.$extraClassName.trim() !== "") {
    const serialized = serializeProp("className", node.$extraClassName, ctx.snippetParamNames);
    if (serialized !== null) attrParts.push(serialized);
  }
  const attrs = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";
  return ok(`${ctx.indent(depth)}<${pascal}${attrs} />`);
}

function renderParamRef(
  node: ParamRef,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  if (!ctx.snippetParamNames?.has(node.$param)) {
    return err(unknownComponent(`$param:${node.$param}`));
  }
  return ok(`${ctx.indent(depth)}{${node.$param}}`);
}

/**
 * Drop the props `<tag>` can't take, so a primitive lowered to plain HTML never
 * prints an invalid DOM attribute — and say so, so the agent moves the intent
 * into the channel that carries it.
 */
function dropForeignProps(
  ref: string,
  tag: string,
  props: Record<string, unknown>,
  channel: "style" | "className",
  ctx: EmitContext,
): void {
  const dropped = Object.keys(props).filter((name) => !isDomProp(tag, name));
  if (dropped.length === 0) return;
  for (const name of dropped) delete props[name];
  const names = dropped.map((name) => `"${name}"`).join(", ");
  ctx.warnings?.push(
    `${ref} emits as a plain <${tag}>, which takes no ${names} — dropped from the code (the canvas ignores ${dropped.length === 1 ? "it" : "them"} too). ${ref} is velloo's own primitive, not another library's component: express the intent through \`${channel}\`.`,
  );
}

/** Structural defaults a lowering adds; a prop the node set itself wins. */
function spliceExtraProps(
  props: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): void {
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (props[k] === undefined) props[k] = v;
  }
}

function renderComponent(
  node: ComponentNode,
  emit: Emit,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  let props: Record<string, unknown> = { ...(node.props ?? {}) };
  // Strip active content from an SVG `content` string before it lands in the
  // consumer app via dangerouslySetInnerHTML (design JSON is untrusted).
  sanitizeEmittedProps(node.$ref, props);
  const childrenProp = props.children;
  delete props.children;
  // Special-case className: if it's a `$param` or `$if` inside a snippet body,
  // bypass class-merging and pass through serializeProp so the expression
  // survives codegen verbatim. Static string classNames keep the merge.
  const rawClassName = props.className;
  delete props.className;
  const isClassNameExpr =
    !!ctx.snippetParamNames &&
    typeof rawClassName === "object" &&
    rawClassName !== null &&
    (typeof (rawClassName as { $param?: unknown }).$param === "string" ||
      typeof (rawClassName as { $if?: unknown }).$if === "string");
  const classNameProp = typeof rawClassName === "string" ? rawClassName : "";

  let openTag: string;
  let closeTag: string;
  let mergedClassName: string;
  let loweredFallbackChild: string | undefined;

  if (emit.kind === "inline") {
    // Plain HTML element styled inline. The node's authored `style` merges OVER
    // the structural defaults; no className on this channel.
    const lowered = emit.lower(props);
    for (const k of emit.consumed ?? []) delete props[k];
    const authored =
      props.style && typeof props.style === "object" && !Array.isArray(props.style)
        ? (props.style as Record<string, unknown>)
        : undefined;
    const mergedStyle = { ...lowered.style, ...(authored ?? {}) };
    if (Object.keys(mergedStyle).length > 0) props.style = mergedStyle;
    else delete props.style;
    dropForeignProps(node.$ref, lowered.tag, props, "style", ctx);
    spliceExtraProps(props, lowered.extraProps);
    mergedClassName = "";
    openTag = lowered.tag;
    closeTag = lowered.tag;
  } else if (emit.kind === "lowered") {
    const lowered = emit.lower(props);
    mergedClassName = mergeClasses(lowered.extraClasses, classNameProp);
    for (const k of emit.consumed ?? []) delete props[k];
    dropForeignProps(node.$ref, lowered.tag, props, "className", ctx);
    spliceExtraProps(props, lowered.extraProps);
    loweredFallbackChild = lowered.fallbackChild;
    openTag = lowered.tag;
    closeTag = lowered.tag;
  } else if (emit.kind === "dynamic") {
    const { jsxName, extraClasses } = emit.resolve(props);
    // A dynamic Icon name can't survive lowering (see dynamicIconName):
    // resolve() fell back to <HelpCircle> and every instance would render
    // that same glyph. Flag it — a `node` param (emitted as a {slot}) is
    // the right tool for a per-instance icon.
    const dynName = dynamicIconName(node);
    if (dynName) {
      ctx.warnings?.push(
        `Icon "name" is dynamic (${dynName}) but lowered to a static <${jsxName}> fallback — a lucide icon name must be a literal JSX tag, so every instance renders the same glyph. For a per-instance icon, declare a \`node\` param (it emits as a {slot} the caller fills) instead of an \`icon\` param, or wire a name→component map in your app.`,
      );
    }
    mergedClassName = mergeClasses(extraClasses, classNameProp);
    for (const k of emit.consumed ?? []) delete props[k];
    openTag = jsxName;
    closeTag = jsxName;
  } else {
    mergedClassName = mergeClasses(classNameProp);
    openTag = emit.jsxName;
    closeTag = emit.jsxName;
    if (emit.nativeProps) props = renameProps(props, emit.nativeProps);
  }

  const attrParts: string[] = [];
  if (isClassNameExpr) {
    const cn = serializeProp("className", rawClassName, ctx.snippetParamNames);
    if (cn) attrParts.push(cn);
  } else if (mergedClassName) {
    const cn = serializeProp("className", mergedClassName, ctx.snippetParamNames);
    if (cn) attrParts.push(cn);
  }
  for (const [name, value] of Object.entries(props)) {
    const serialized = serializeProp(name, value, ctx.snippetParamNames);
    if (serialized !== null) attrParts.push(serialized);
  }

  const pad = ctx.indent(depth);
  const childPad = ctx.indent(depth + 1);
  const attrs = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";

  // Fall back to the lowered entry's `fallbackChild` (e.g. Placeholder's label)
  // when no caller-provided children exist.
  const effectiveChild =
    childrenProp === undefined &&
    (!Array.isArray(node.children) || node.children.length === 0) &&
    loweredFallbackChild !== undefined
      ? loweredFallbackChild
      : childrenProp;

  const hasNodeChildren = Array.isArray(node.children) && node.children.length > 0;
  const hasStringChild = typeof effectiveChild === "string" && effectiveChild.length > 0;
  const isChildParamRef =
    effectiveChild !== null &&
    typeof effectiveChild === "object" &&
    typeof (effectiveChild as { $param?: unknown }).$param === "string";
  const isChildIf =
    effectiveChild !== null &&
    typeof effectiveChild === "object" &&
    typeof (effectiveChild as { $if?: unknown }).$if === "string";
  const hasOtherChild =
    effectiveChild !== undefined &&
    !hasStringChild &&
    !isChildParamRef &&
    !isChildIf &&
    !(Array.isArray(effectiveChild) && effectiveChild.length === 0);

  if (!hasNodeChildren && !hasStringChild && !hasOtherChild && !isChildParamRef && !isChildIf) {
    return ok(`${pad}<${openTag}${attrs} />`);
  }

  if (hasNodeChildren) {
    const parts: string[] = [];
    for (const child of node.children ?? []) {
      const childR = renderNode(child, ctx, depth + 1);
      if (!childR.ok) return childR;
      parts.push(childR.value);
    }
    return ok(`${pad}<${openTag}${attrs}>\n${parts.join("\n")}\n${pad}</${closeTag}>`);
  }

  if (isChildParamRef) {
    const name = (effectiveChild as { $param: string }).$param;
    if (!ctx.snippetParamNames?.has(name)) {
      return err(unknownComponent(`$param:${name}`));
    }
    return ok(`${pad}<${openTag}${attrs}>{${name}}</${closeTag}>`);
  }

  if (isChildIf) {
    if (!ctx.snippetParamNames) {
      return err(unknownComponent(`$if outside snippet body`));
    }
    const expr = serializeIfExpr(
      effectiveChild as { $if: string; then?: unknown; else?: unknown },
      ctx.snippetParamNames,
    );
    if (expr === null) {
      return err(
        unknownComponent(`$if:${(effectiveChild as { $if: string }).$if} (unknown param)`),
      );
    }
    return ok(`${pad}<${openTag}${attrs}>{${expr}}</${closeTag}>`);
  }

  // Inline rich text: a `children` prop holding node(s), optionally interleaved
  // with text runs — "You get <Text>the math right</Text>". Text runs emit as
  // JS string expressions (`{"You get "}`) so explicit spacing survives JSX's
  // whitespace collapsing across newlines.
  if (Array.isArray(effectiveChild)) {
    const parts: string[] = [];
    for (const item of effectiveChild) {
      if (isNode(item)) {
        const childR = renderNode(item as Node, ctx, depth + 1);
        if (!childR.ok) return childR;
        parts.push(childR.value);
      } else if (typeof item === "string" || typeof item === "number") {
        parts.push(`${childPad}{${JSON.stringify(String(item))}}`);
      } else {
        parts.push(`${childPad}{${JSON.stringify(item)}}`);
      }
    }
    return ok(`${pad}<${openTag}${attrs}>\n${parts.join("\n")}\n${pad}</${closeTag}>`);
  }

  // A single node-shaped `children` prop value (`children: {$ref:"Icon",…}`).
  if (isComponentNode(effectiveChild as Node) || isSnippetInstance(effectiveChild as Node)) {
    const childR = renderNode(effectiveChild as Node, ctx, depth + 1);
    if (!childR.ok) return childR;
    return ok(`${pad}<${openTag}${attrs}>\n${childR.value}\n${pad}</${closeTag}>`);
  }

  if (hasStringChild) {
    const text = serializeTextChild(effectiveChild as string);
    if (text.length < 60 && !text.includes("\n")) {
      return ok(`${pad}<${openTag}${attrs}>${text}</${closeTag}>`);
    }
    return ok(`${pad}<${openTag}${attrs}>\n${childPad}${text}\n${pad}</${closeTag}>`);
  }

  return ok(
    `${pad}<${openTag}${attrs}>\n${childPad}{${JSON.stringify(effectiveChild)}}\n${pad}</${closeTag}>`,
  );
}

/**
 * The JSX name a repository component prints as: its export (`Tabs.List` for a
 * compound part), or for a default export the name the design gave it.
 */
export function repoJsxName(node: RepoNode): string {
  const root =
    node.$repo.exportName === "default"
      ? (node.$ref.split(".")[0] ?? node.$ref)
      : node.$repo.exportName;
  return [root, node.$repo.member].filter(Boolean).join(".");
}

/**
 * A repository component emits as itself: its exact import, every authored
 * prop as written (a Mantine `variant`, an `sx`, a `style` object — nothing is
 * lowered or translated into another styling system), node-valued props as
 * JSX, and its children. The design's proxy, if any, never reaches the code.
 */
/** `icon={<Plus />}` — a node-valued prop or argument, emitted as JSX. */
function nodeAttr(
  prop: string,
  value: Node,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  const slot = renderNode(value, ctx, depth + 1);
  if (!slot.ok) return slot;
  const jsx = slot.value.trim();
  return ok(`${prop}={${jsx.includes("\n") ? `\n${slot.value}\n${ctx.indent(depth)}` : jsx}}`);
}

function renderRepoComponent(
  node: RepoNode,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  const name = repoJsxName(node);
  if (!VALID_JSX_NAME.test(name) || repoImportIssue(node.$repo.importPath) !== null) {
    return err(unknownComponent(`$repo:${node.$ref}`));
  }
  const props = { ...(node.props ?? {}) };
  const childrenProp = props.children;
  delete props.children;
  const attrParts: string[] = [];
  for (const [prop, value] of Object.entries(props)) {
    if (isComponentNode(value as Node) || isSnippetInstance(value as Node)) {
      const slot = nodeAttr(prop, value as Node, ctx, depth);
      if (!slot.ok) return slot;
      attrParts.push(slot.value);
      continue;
    }
    const serialized = serializeProp(prop, value, ctx.snippetParamNames);
    if (serialized !== null) attrParts.push(serialized);
  }
  const pad = ctx.indent(depth);
  const attrs = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";
  if (Array.isArray(node.children) && node.children.length > 0) {
    const parts: string[] = [];
    for (const child of node.children) {
      const childR = renderNode(child, ctx, depth + 1);
      if (!childR.ok) return childR;
      parts.push(childR.value);
    }
    return ok(`${pad}<${name}${attrs}>\n${parts.join("\n")}\n${pad}</${name}>`);
  }
  if (typeof childrenProp === "string" || typeof childrenProp === "number") {
    return ok(`${pad}<${name}${attrs}>${serializeTextChild(String(childrenProp))}</${name}>`);
  }
  // Nodes mixed with text runs, as the provider path emits them.
  if (Array.isArray(childrenProp) && childrenProp.length > 0) {
    const parts: string[] = [];
    for (const item of childrenProp) {
      if (isNode(item)) {
        const childR = renderNode(item as Node, ctx, depth + 1);
        if (!childR.ok) return childR;
        parts.push(childR.value);
      } else {
        const text = typeof item === "string" || typeof item === "number" ? String(item) : item;
        parts.push(`${ctx.indent(depth + 1)}{${JSON.stringify(text)}}`);
      }
    }
    return ok(`${pad}<${name}${attrs}>\n${parts.join("\n")}\n${pad}</${name}>`);
  }
  if (childrenProp !== undefined && childrenProp !== null && typeof childrenProp === "object") {
    const isParam = typeof (childrenProp as { $param?: unknown }).$param === "string";
    if (isParam && ctx.snippetParamNames?.has((childrenProp as { $param: string }).$param)) {
      return ok(
        `${pad}<${name}${attrs}>{${(childrenProp as { $param: string }).$param}}</${name}>`,
      );
    }
    if (isComponentNode(childrenProp as Node) || isSnippetInstance(childrenProp as Node)) {
      const childR = renderNode(childrenProp as Node, ctx, depth + 1);
      if (!childR.ok) return childR;
      return ok(`${pad}<${name}${attrs}>\n${childR.value}\n${pad}</${name}>`);
    }
  }
  return ok(`${pad}<${name}${attrs} />`);
}

/** Rename props to the framework's own names, keeping their order; an authored native name wins. */
function renameProps(
  props: Record<string, unknown>,
  names: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    const native = names[name];
    if (native === undefined) out[name] = value;
    else if (!(native in props)) out[native] = value;
  }
  return out;
}
