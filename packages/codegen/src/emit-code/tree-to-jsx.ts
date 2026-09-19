import { err, ok, type Result } from "@velloo/result";
import {
  applySnippetExtraClassName,
  applySnippetOverrides,
  type ComponentNode,
  isComponentNode,
  isParamRef,
  isSnippetInstance,
  type Node,
  type RepoComponentRef,
  repoImportIssue,
  resolveSnippetArgs,
  type Snippet,
  substituteSnippetParams,
} from "@velloo/schema";
import {
  inlineNoneLower,
  LOWERED_CONSUMED_PROPS,
  REGISTRY,
  sanitizeEmittedProps,
} from "../component-registry.ts";
import { type CodegenError, unknownComponent } from "../errors.ts";
import { mergeClasses } from "./classes.ts";
import { dynamicIconName } from "./dynamic-icon.ts";
import { serializeIfExpr, serializeProp, serializeTextChild } from "./props.ts";
import type { CodegenTarget } from "./target.ts";

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
   * Folder-scoped extensions. Keyed by component id, value carries the
   * import specifier emit_code should produce. When a `$ref` isn't in the
   * built-in REGISTRY, the resolver falls through to here — and codegen
   * emits `import { <id> } from <importPath>` (verbatim, no alias rewrite)
   * so the agent's emit lands in the user's app at the path they declared.
   */
  extensions?: Map<string, { importPath: string }> | undefined;
  /**
   * Active framework target (e.g. MUI). When it resolves a `$ref`, the
   * component emits as a bare import from the framework's module and skips the
   * shadcn lowering — its `sx`/`style` object serializes as a normal prop.
   * Absent ⇒ default shadcn behavior. Consulted *before* the REGISTRY so a MUI
   * screen's `Card`/`Box` resolve to MUI, not the shadcn primitive of that id.
   */
  target?: CodegenTarget | undefined;
  /**
   * The folder is a no-CSS-framework (`none/none`) folder: the no-lib primitives
   * lower to plain HTML with inline `style` defaults (no Tailwind), consulted
   * before the REGISTRY. Set from `config.styling.framework === "none"`.
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
  // Host-component facade: the canvas rendered this node's approximation subtree,
  // but codegen emits the app's real component import instead (identity preserved
  // through scan → design → emit). Bare `<Name />` — the data-bound props live in
  // the app, not the design. See ComponentNode.$emitAs.
  if (node.$repo)
    return renderRepoComponent(node as ComponentNode & { $repo: RepoComponentRef }, ctx, depth);

  const emitAs = node.$emitAs;
  if (emitAs) {
    if (!VALID_JSX_NAME.test(emitAs.name) || !VALID_IMPORT_SPECIFIER.test(emitAs.importPath)) {
      return err(unknownComponent(`$emitAs:${emitAs.name}`));
    }
    return ok(`${ctx.indent(depth)}<${emitAs.name} />`);
  }

  type SyntheticEntry = (typeof REGISTRY)[string] & { __bareImport?: boolean | undefined };
  // none/none folder: a no-lib primitive (Box/Stack/Card/Button/…) lowers to
  // plain HTML + inline `style` defaults — consulted FIRST so `Card`/`Button`
  // resolve to a styled `<div>`/`<button>`, not the shadcn import of that id.
  // Helpers (Icon/Image/…) return null here and fall through to the REGISTRY.
  const inlineLowered = ctx.inlineStyle ? inlineNoneLower(node.$ref, node.props ?? {}) : null;

  // A framework target (MUI) wins over the shadcn REGISTRY: a MUI screen's
  // `Card`/`Box` must resolve to `@mui/material`, not the shadcn primitive of
  // the same id. The component emits as a bare import + its `sx` object flows
  // through the generic prop path (no Tailwind lowering, no className merge).
  let entry: SyntheticEntry | undefined;
  if (!inlineLowered) {
    const native = ctx.target?.importFor(node.$ref) ?? null;
    if (native) {
      entry = {
        kind: "shadcn",
        jsxName: native.jsxName,
        importFile: native.from,
        __bareImport: true,
      };
    } else {
      // Built-in (library) component? Use the static registry entry which
      // knows the lowering / cva variant / shadcn import path.
      entry = REGISTRY[node.$ref];
      if (!entry) {
        // Registered extension? Synthesize a shadcn-shaped registry entry so
        // the rest of this function reads the importPath off it and uses the
        // ref's own id as the JSX name. Extensions are always emitted as
        // bare external imports with the user-supplied importPath.
        const ext = ctx.extensions?.get(node.$ref);
        if (ext) {
          if (!VALID_JSX_NAME.test(node.$ref) || !VALID_IMPORT_SPECIFIER.test(ext.importPath)) {
            return err(unknownComponent(node.$ref));
          }
          entry = {
            kind: "shadcn",
            jsxName: node.$ref,
            importFile: ext.importPath,
            // Mark so the import set uses `addBare` (verbatim path) rather
            // than `add` (which prepends componentsAlias).
            __bareImport: true,
          };
        }
      }
    }
    if (!entry) return err(unknownComponent(node.$ref));
  }

  const props = { ...(node.props ?? {}) };
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

  if (inlineLowered) {
    // Plain HTML element styled inline. The node's authored `style` merges OVER
    // the structural defaults; no className/import on this channel.
    for (const k of inlineLowered.consumed) delete props[k];
    const authored =
      props.style && typeof props.style === "object" && !Array.isArray(props.style)
        ? (props.style as Record<string, unknown>)
        : undefined;
    const mergedStyle = { ...inlineLowered.style, ...(authored ?? {}) };
    if (Object.keys(mergedStyle).length > 0) props.style = mergedStyle;
    else delete props.style;
    if (inlineLowered.extraProps) {
      for (const [k, v] of Object.entries(inlineLowered.extraProps)) {
        if (props[k] === undefined) props[k] = v;
      }
    }
    mergedClassName = "";
    openTag = inlineLowered.tag;
    closeTag = inlineLowered.tag;
  } else if (entry?.kind === "lowered") {
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
  } else if (entry?.kind === "dynamic") {
    const { jsxName, extraClasses } = entry.resolve(props);
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
    const consumed = LOWERED_CONSUMED_PROPS[node.$ref];
    if (consumed) for (const k of consumed) delete props[k];
    openTag = jsxName;
    closeTag = jsxName;
  } else if (entry) {
    mergedClassName = mergeClasses(classNameProp);
    openTag = entry.jsxName;
    closeTag = entry.jsxName;
  } else {
    // Unreachable: a non-inline node always resolves an entry (or returned
    // UnknownComponent above). Keeps the compiler happy about the union.
    return err(unknownComponent(node.$ref));
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
      if (isComponentNode(item) || isSnippetInstance(item) || isParamRef(item)) {
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
function repoJsxName(node: ComponentNode & { $repo: RepoComponentRef }): string {
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
function renderRepoComponent(
  node: ComponentNode & { $repo: RepoComponentRef },
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
      const slot = renderNode(value as Node, ctx, depth + 1);
      if (!slot.ok) return slot;
      const jsx = slot.value.trim();
      attrParts.push(
        `${prop}={${jsx.includes("\n") ? `\n${slot.value}\n${ctx.indent(depth)}` : jsx}}`,
      );
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
      if (isComponentNode(item) || isSnippetInstance(item) || isParamRef(item)) {
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
