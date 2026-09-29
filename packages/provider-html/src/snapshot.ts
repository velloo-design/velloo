/**
 * A screen as a viewer with no host app shows it: every `HtmlFragment`
 * becomes an `Html` element holding the markup the host returned when the
 * screen was captured. The markup arrives already parsed by a browser (see
 * `HostFragmentCapture`); here it becomes nodes, and only what `Html` may
 * render survives — the published tree is untrusted input to the viewer, and
 * this is where host output that was never written as a design is narrowed.
 */
import type { HostContent, HostElement, HostFragmentCapture } from "@velloo/provider";
import { type ComponentNode, isComponentNode, type Node } from "@velloo/schema";
import { isSafeTag, safeAttributeValue } from "./registry.ts";

/** Elements whose content is code, metadata or an embedded document: gone with everything inside. */
const DROPPED = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "link",
  "meta",
  "base",
  "head",
  "title",
]);

/** Parents in which whitespace between elements is formatting, and a text node is invalid DOM. */
const NO_TEXT_PARENTS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
  "select",
  "optgroup",
  "ul",
  "ol",
  "dl",
]);

/** Present-or-absent attributes: HTML writes them empty, React needs `true`. */
const BOOLEAN_ATTRIBUTES = new Set([
  "disabled",
  "checked",
  "selected",
  "readonly",
  "required",
  "multiple",
  "hidden",
  "autofocus",
  "novalidate",
  "formnovalidate",
  "open",
  "reversed",
  "controls",
  "loop",
  "muted",
  "playsinline",
  "default",
  "inert",
  "itemscope",
]);

type Run = string | Node;

function attributesFor(element: HostElement): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(element.attrs)) {
    if (!safeAttributeValue(name, value)) continue;
    const key = name.toLowerCase();
    // Uncontrolled on purpose: a published page is looked at, not submitted,
    // and a controlled `value` with no handler is React's read-only warning.
    if (key === "value" && element.tag !== "option" && element.tag !== "li") {
      props.defaultValue = value;
    } else if (key === "checked") {
      props.defaultChecked = true;
    } else {
      props[name] = BOOLEAN_ATTRIBUTES.has(key) && value === "" ? true : value;
    }
  }
  return props;
}

function convert(content: HostContent[], parent: string): Run[] {
  const preformatted = parent === "pre" || parent === "textarea";
  const runs: Run[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.trim() === "") {
        if (!NO_TEXT_PARENTS.has(parent) && item.length > 0) runs.push(preformatted ? item : " ");
      } else {
        runs.push(preformatted ? item : item.replace(/\s+/g, " "));
      }
      continue;
    }
    const tag = item.tag;
    if (DROPPED.has(tag.toLowerCase())) continue;
    // An element `Html` won't render (a custom element, `<video>`, `<use>`)
    // gives way to its content rather than taking its subtree with it.
    if (!isSafeTag(tag)) {
      runs.push(...convert(item.children, parent));
      continue;
    }
    const props: Record<string, unknown> = { as: tag, ...attributesFor(item) };
    if (tag === "textarea") {
      const text = item.children.filter((c): c is string => typeof c === "string").join("");
      if (text) props.defaultValue = text;
    } else {
      const children = convert(item.children, tag);
      if (children.length === 1 && typeof children[0] === "string") props.children = children[0];
      else if (children.length > 0) props.children = children;
    }
    runs.push({ $ref: "Html", props });
  }
  // Adjacent text (a dropped element between two runs) reads as one run.
  return runs.reduce<Run[]>((merged, run) => {
    const last = merged[merged.length - 1];
    if (typeof run === "string" && typeof last === "string") merged[merged.length - 1] = last + run;
    else merged.push(run);
    return merged;
  }, []);
}

/**
 * The props of a fragment the static element keeps: everything but how it
 * loaded, with the class and style it showed — its own plus the loaded page's
 * body layout.
 */
function wrapperProps(
  fragment: ComponentNode,
  captured: HostFragmentCapture,
): Record<string, unknown> {
  const { src, select, boost, as, children: _placeholder, ...rest } = fragment.props ?? {};
  const shown = {
    ...(captured.className ? { className: captured.className } : {}),
    ...(captured.style && typeof rest.style !== "object" ? { style: captured.style } : {}),
  };
  return { as: typeof as === "string" ? as : "div", ...rest, ...shown };
}

/**
 * Content runs as a design's own nodes: an element whose content is only
 * elements (the whitespace between them is formatting) takes them as tree
 * children, so the tree can open it; one that mixes text and elements keeps
 * them as inline runs, the way a paragraph with a link is written by hand.
 */
function editable(runs: Run[]): { children?: Node[]; runs?: Run[] } {
  const meaningful = runs.filter((run) => typeof run !== "string" || run.trim() !== "");
  if (meaningful.length === 0) return {};
  if (!meaningful.every((run) => typeof run !== "string")) return { runs };
  return { children: (meaningful as Node[]).map(editableNode) };
}

function editableNode(node: Node): Node {
  if (!isComponentNode(node)) return node;
  const { children, class: className, ...rest } = node.props ?? {};
  // `className` is what the inspector and the class tools edit.
  const props = className === undefined ? rest : { ...rest, className };
  if (!Array.isArray(children) && (typeof children !== "object" || children === null)) {
    return { ...node, props: children === undefined ? props : { ...props, children } };
  }
  const content = editable(Array.isArray(children) ? (children as Run[]) : [children as Node]);
  return {
    ...node,
    props: content.runs ? { ...props, children: content.runs } : props,
    ...(content.children ? { children: content.children } : {}),
  };
}

/**
 * `tree` with each captured `HtmlFragment` replaced by a static `Html`
 * element.
 *
 * For a publish (the default), the captured markup travels as the element's
 * content runs, so it renders inline without becoming separately addressable
 * nodes — comments and annotations on the fragment keep pointing at the same
 * path. With `editable`, it becomes the design's own nodes instead, and the
 * element remembers the route it came from (`snapshotOf`) so `liveAgain` can
 * capture it afresh.
 */
export function staticSnapshot(
  tree: Node,
  fragments: HostFragmentCapture[],
  opts: { editable?: boolean } = {},
): { tree: Node; warnings: string[] } {
  const warnings: string[] = [];
  const byPath = new Map(fragments.map((fragment) => [fragment.path, fragment]));
  const visit = (node: Node, path: number[]): Node => {
    if (!isComponentNode(node)) return node;
    if (node.$ref === "HtmlFragment") {
      const src = String(node.props?.src ?? "");
      const captured = byPath.get(path.join("."));
      if (!captured) {
        warnings.push(
          `HtmlFragment ${src} was not captured; the published page shows its placeholder.`,
        );
        return node;
      }
      if (captured.truncated) {
        warnings.push(
          `HtmlFragment ${src} is too large to publish whole; only its first part was kept.`,
        );
      }
      const as = String(node.props?.as ?? "div");
      const runs = convert(captured.content, as);
      const { $id } = node;
      if (opts.editable) {
        const select = node.props?.select;
        const content = editable(runs);
        return {
          $ref: "Html",
          ...($id ? { $id } : {}),
          props: {
            ...wrapperProps(node, captured),
            snapshotOf: src,
            ...(typeof select === "string" ? { snapshotSelect: select } : {}),
            ...(content.runs ? { children: content.runs } : {}),
          },
          ...(content.children ? { children: content.children } : {}),
        };
      }
      return {
        $ref: "Html",
        ...($id ? { $id } : {}),
        props: {
          ...wrapperProps(node, captured),
          ...(runs.length > 0 ? { children: runs } : {}),
        },
      };
    }
    if (!node.children) return node;
    return { ...node, children: node.children.map((child, i) => visit(child, [...path, i])) };
  };
  return { tree: visit(tree, []), warnings };
}

/**
 * `tree` with every design snapshot (an `Html` holding `snapshotOf`) turned
 * back into the `HtmlFragment` it was captured from — what a refresh
 * captures again. Its content, and any edits to it, go: the app's page is the
 * source of a snapshot.
 */
export function liveAgain(tree: Node): Node {
  if (!isComponentNode(tree)) return tree;
  const source = tree.props?.snapshotOf;
  if (tree.$ref === "Html" && typeof source === "string") {
    const { snapshotOf: _src, snapshotSelect, children: _content, ...props } = tree.props ?? {};
    const { $id } = tree;
    return {
      $ref: "HtmlFragment",
      ...($id ? { $id } : {}),
      props: {
        ...props,
        src: source,
        ...(typeof snapshotSelect === "string" ? { select: snapshotSelect } : {}),
      },
    };
  }
  if (!tree.children) return tree;
  return { ...tree, children: tree.children.map(liveAgain) };
}
