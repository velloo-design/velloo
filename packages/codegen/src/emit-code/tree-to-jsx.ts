import { err, ok, type Result } from "@velloo/result";
import type { Node } from "@velloo/schema";
import { LOWERED_CONSUMED_PROPS, REGISTRY } from "../component-registry.ts";
import { type CodegenError, unknownComponent } from "../errors.ts";
import { mergeClasses } from "./classes.ts";
import type { ImportSet } from "./imports.ts";
import { serializeProp, serializeTextChild } from "./props.ts";

export interface EmitContext {
  imports: ImportSet;
  componentsAlias: string;
  /** 2-space indentation, baked once. */
  indent(depth: number): string;
}

/** Render a node tree (root) as a single JSX string. */
export function emitTree(root: Node, ctx: EmitContext): Result<string, CodegenError> {
  return renderNode(root, ctx, 0);
}

function renderNode(node: Node, ctx: EmitContext, depth: number): Result<string, CodegenError> {
  const entry = REGISTRY[node.$ref];
  if (!entry) return err(unknownComponent(node.$ref));

  const props = { ...(node.props ?? {}) };
  const childrenProp = props.children;
  delete props.children;
  const classNameProp = typeof props.className === "string" ? (props.className as string) : "";
  delete props.className;

  let openTag: string;
  let closeTag: string;
  let mergedClassName: string;

  if (entry.kind === "lowered") {
    const { tag, extraClasses } = entry.lower(props);
    mergedClassName = mergeClasses(extraClasses, classNameProp);
    // Strip props consumed by the lowering (e.g. Heading.level, Text.variant).
    const consumed = LOWERED_CONSUMED_PROPS[node.$ref];
    if (consumed) for (const k of consumed) delete props[k];
    openTag = tag;
    closeTag = tag;
  } else if (entry.kind === "dynamic") {
    const { jsxName, extraClasses } = entry.resolve(props);
    ctx.imports.addBare(entry.importFrom, jsxName);
    mergedClassName = mergeClasses(extraClasses, classNameProp);
    const consumed = LOWERED_CONSUMED_PROPS[node.$ref];
    if (consumed) for (const k of consumed) delete props[k];
    openTag = jsxName;
    closeTag = jsxName;
  } else {
    ctx.imports.add(entry.importFile, entry.jsxName);
    mergedClassName = mergeClasses(classNameProp);
    openTag = entry.jsxName;
    closeTag = entry.jsxName;
  }

  const attrParts: string[] = [];
  if (mergedClassName) {
    const cn = serializeProp("className", mergedClassName);
    if (cn) attrParts.push(cn);
  }
  for (const [name, value] of Object.entries(props)) {
    const serialized = serializeProp(name, value);
    if (serialized !== null) attrParts.push(serialized);
  }

  const pad = ctx.indent(depth);
  const childPad = ctx.indent(depth + 1);
  const attrs = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";

  const hasNodeChildren = Array.isArray(node.children) && node.children.length > 0;
  const hasStringChild = typeof childrenProp === "string" && childrenProp.length > 0;
  const hasOtherChild = childrenProp !== undefined && !hasStringChild;

  if (!hasNodeChildren && !hasStringChild && !hasOtherChild) {
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

  if (hasStringChild) {
    const text = serializeTextChild(childrenProp as string);
    // If the text is short enough, keep it inline; otherwise put it on its own line.
    if (text.length < 60 && !text.includes("\n")) {
      return ok(`${pad}<${openTag}${attrs}>${text}</${closeTag}>`);
    }
    return ok(`${pad}<${openTag}${attrs}>\n${childPad}${text}\n${pad}</${closeTag}>`);
  }

  // Non-string children prop (number, boolean, object). JSON-encode inside braces.
  return ok(
    `${pad}<${openTag}${attrs}>\n${childPad}{${JSON.stringify(childrenProp)}}\n${pad}</${closeTag}>`,
  );
}
