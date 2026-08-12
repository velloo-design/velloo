import type { Node } from "@velloo/schema";
import { LOWERED_CONSUMED_PROPS, REGISTRY } from "../component-registry.ts";
import { mergeClasses } from "./classes.ts";
import type { ImportSet } from "./imports.ts";
import { serializeProp, serializeTextChild } from "./props.ts";

export interface EmitContext {
  imports: ImportSet;
  componentsAlias: string;
  /** 2-space indentation, baked once. */
  indent(depth: number): string;
}

export class UnknownComponentError extends Error {
  constructor(public readonly ref: string) {
    super(`Unknown component in codegen: ${JSON.stringify(ref)}`);
    this.name = "UnknownComponentError";
  }
}

/** Render a node tree (root) as a single JSX string. */
export function emitTree(root: Node, ctx: EmitContext): string {
  return renderNode(root, ctx, 0);
}

function renderNode(node: Node, ctx: EmitContext, depth: number): string {
  const entry = REGISTRY[node.$ref];
  if (!entry) throw new UnknownComponentError(node.$ref);

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
    return `${pad}<${openTag}${attrs} />`;
  }

  if (hasNodeChildren) {
    const inner = (node.children ?? [])
      .map((child) => renderNode(child, ctx, depth + 1))
      .join("\n");
    return `${pad}<${openTag}${attrs}>\n${inner}\n${pad}</${closeTag}>`;
  }

  if (hasStringChild) {
    const text = serializeTextChild(childrenProp as string);
    // If the text is short enough, keep it inline; otherwise put it on its own line.
    if (text.length < 60 && !text.includes("\n")) {
      return `${pad}<${openTag}${attrs}>${text}</${closeTag}>`;
    }
    return `${pad}<${openTag}${attrs}>\n${childPad}${text}\n${pad}</${closeTag}>`;
  }

  // Non-string children prop (number, boolean, object). JSON-encode inside braces.
  return `${pad}<${openTag}${attrs}>\n${childPad}{${JSON.stringify(childrenProp)}}\n${pad}</${closeTag}>`;
}
