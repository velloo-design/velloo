import { err, ok, type Result } from "@velloo/result";
import {
  applySnippetExtraClassName,
  applySnippetOverrides,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  resolveSnippetArgs,
  type Snippet,
  substituteSnippetParams,
} from "@velloo/schema";
import { LOWERED_CONSUMED_PROPS, REGISTRY } from "../component-registry.ts";
import { type CodegenError, unknownComponent } from "../errors.ts";
import { mergeClasses } from "./classes.ts";
import type { ImportSet } from "./imports.ts";
import { serializeIfExpr, serializeProp, serializeTextChild } from "./props.ts";

export interface EmitContext {
  imports: ImportSet;
  componentsAlias: string;
  /** Where snippet React components live. Defaults to `<componentsAlias>/../snippets`. */
  snippetsAlias?: string;
  /** PascalCase names for each snippet id. Used to emit `<FeatureCard />` from `$snippet: "feature-card"`. */
  snippetPascalById?: Map<string, string>;
  /** Snippet definitions — required to inline instances carrying `$overrides`. */
  snippets?: Map<string, Snippet>;
  /** Set when emitting *inside* a snippet body: `$param` nodes become `{name}`. */
  snippetParamNames?: Set<string>;
  /**
   * Folder-scoped extensions. Keyed by component id, value carries the
   * import specifier emit_code should produce. When a `$ref` isn't in the
   * built-in REGISTRY, the resolver falls through to here — and codegen
   * emits `import { <id> } from <importPath>` (verbatim, no alias rewrite)
   * so the agent's emit lands in the user's app at the path they declared.
   */
  extensions?: Map<string, { importPath: string }>;
  /**
   * Single-shot: when present, the next ComponentNode renderComponent call
   * (the snippet body's root) splices `${holder.varName}` into its className.
   * Cleared after first use so descendants don't re-merge it.
   */
  injectClassNameAtRoot?: { varName: string; used: boolean };
  /**
   * Non-fatal emit caveats accumulated during the walk (e.g. an Icon whose
   * `name` is a dynamic param, which can't survive lowering — see
   * renderComponent). Surfaced on the emit result so the agent self-corrects
   * instead of silently shipping the fallback.
   */
  warnings?: string[];
  /** 2-space indentation, baked once. */
  indent(depth: number): string;
}

/** If `value` is a `$param`/`$if` substitution, describe it; else null. */
function dynamicRefName(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as { $param?: unknown; $if?: unknown };
  if (typeof v.$param === "string") return `param "${v.$param}"`;
  if (typeof v.$if === "string") return `$if on "${v.$if}"`;
  return null;
}

/** Render a node tree (root) as a single JSX string. */
export function emitTree(root: Node, ctx: EmitContext): Result<string, CodegenError> {
  return renderNode(root, ctx, 0);
}

function renderNode(node: Node, ctx: EmitContext, depth: number): Result<string, CodegenError> {
  if (isSnippetInstance(node)) {
    return renderSnippetInstance(node, ctx, depth);
  }
  if (isParamRef(node)) {
    return renderParamRef(node, ctx, depth);
  }
  if (!isComponentNode(node)) {
    return err(unknownComponent(`<unknown node kind>`));
  }
  return renderComponent(node, ctx, depth);
}

function renderSnippetInstance(
  node: import("@velloo/schema").SnippetInstance,
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
  const snippetsAlias = ctx.snippetsAlias ?? `${ctx.componentsAlias}/../snippets`;
  // Bare so the path is used verbatim — ImportSet.add() would prepend
  // componentsAlias a second time.
  ctx.imports.addBare(`${snippetsAlias}/${pascal}`, pascal);

  const attrParts: string[] = [];
  for (const [name, value] of Object.entries(node.args ?? {})) {
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
  node: import("@velloo/schema").ParamRef,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  if (!ctx.snippetParamNames?.has(node.$param)) {
    return err(unknownComponent(`$param:${node.$param}`));
  }
  return ok(`${ctx.indent(depth)}{${node.$param}}`);
}

function renderComponent(
  node: import("@velloo/schema").ComponentNode,
  ctx: EmitContext,
  depth: number,
): Result<string, CodegenError> {
  // Built-in (library) component? Use the static registry entry which
  // knows the lowering / cva variant / shadcn import path.
  let entry = REGISTRY[node.$ref];
  if (!entry) {
    // Registered extension? Synthesize a shadcn-shaped registry entry so
    // the rest of this function reads the importPath off it and uses the
    // ref's own id as the JSX name. Extensions are always emitted as
    // bare external imports with the user-supplied importPath.
    const ext = ctx.extensions?.get(node.$ref);
    if (ext) {
      entry = {
        kind: "shadcn",
        jsxName: node.$ref,
        importFile: ext.importPath,
        // Mark so the import set uses `addBare` (verbatim path) rather
        // than `add` (which prepends componentsAlias).
        __bareImport: true,
      } as (typeof REGISTRY)[string] & { __bareImport?: boolean };
    }
  }
  if (!entry) return err(unknownComponent(node.$ref));

  const props = { ...(node.props ?? {}) };
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

  if (entry.kind === "lowered") {
    const result = entry.lower(props);
    mergedClassName = mergeClasses(result.extraClasses, classNameProp);
    const consumed = LOWERED_CONSUMED_PROPS[node.$ref];
    if (consumed) for (const k of consumed) delete props[k];
    if (result.extraProps) {
      for (const [k, v] of Object.entries(result.extraProps)) {
        props[k] = v;
      }
    }
    loweredFallbackChild = result.fallbackChild;
    openTag = result.tag;
    closeTag = result.tag;
  } else if (entry.kind === "dynamic") {
    const { jsxName, extraClasses } = entry.resolve(props);
    // A dynamic Icon name (a $param/$if ref) can't survive lowering: the
    // lucide name becomes the JSX tag, which must be a static identifier,
    // so resolve() falls back to <HelpCircle> and every instance would
    // render that same glyph. Flag it — a `node` param (emitted as a
    // {slot}) is the right tool for a per-instance icon.
    const dynName = node.$ref === "Icon" ? dynamicRefName(props.name) : null;
    if (dynName) {
      ctx.warnings?.push(
        `Icon "name" is dynamic (${dynName}) but lowered to a static <${jsxName}> fallback — a lucide icon name must be a literal JSX tag, so every instance renders the same glyph. For a per-instance icon, declare a \`node\` param (it emits as a {slot} the caller fills) instead of an \`icon\` param, or wire a name→component map in your app.`,
      );
    }
    ctx.imports.addBare(entry.importFrom, jsxName);
    mergedClassName = mergeClasses(extraClasses, classNameProp);
    const consumed = LOWERED_CONSUMED_PROPS[node.$ref];
    if (consumed) for (const k of consumed) delete props[k];
    openTag = jsxName;
    closeTag = jsxName;
  } else {
    // Synthetic extension entries set `__bareImport` so the importPath
    // flows through verbatim instead of being prefixed with the
    // components alias.
    if ((entry as { __bareImport?: boolean }).__bareImport) {
      ctx.imports.addBare(entry.importFile, entry.jsxName);
    } else {
      ctx.imports.add(entry.importFile, entry.jsxName);
    }
    mergedClassName = mergeClasses(classNameProp);
    openTag = entry.jsxName;
    closeTag = entry.jsxName;
  }

  // Single-shot: at the root of a snippet body, splice the snippet's
  // `className` prop variable into the rendered className so callers can
  // override styling via instantiate_snippet({extraClassName: "..."}).
  // Template-literal concat — no external `cn` import needed.
  const injectVar =
    ctx.injectClassNameAtRoot && !ctx.injectClassNameAtRoot.used
      ? ctx.injectClassNameAtRoot.varName
      : null;
  if (ctx.injectClassNameAtRoot && !ctx.injectClassNameAtRoot.used) {
    ctx.injectClassNameAtRoot.used = true;
  }

  const attrParts: string[] = [];
  if (isClassNameExpr) {
    const cn = serializeProp("className", rawClassName, ctx.snippetParamNames);
    if (cn) attrParts.push(cn);
  } else if (mergedClassName || injectVar) {
    if (injectVar) {
      const base = mergedClassName ?? "";
      attrParts.push(`className={\`${base}${base ? " " : ""}\${${injectVar} ?? ""}\`}`);
    } else if (mergedClassName) {
      const cn = serializeProp("className", mergedClassName, ctx.snippetParamNames);
      if (cn) attrParts.push(cn);
    }
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
    effectiveChild !== undefined && !hasStringChild && !isChildParamRef && !isChildIf;

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
