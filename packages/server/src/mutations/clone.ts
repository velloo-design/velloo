import type { Node, Page, Variant } from "@velloo/schema";

/** Deep clone a Node tree. Cheap because trees are small JSON. */
export function cloneNode(n: Node): Node {
  return JSON.parse(JSON.stringify(n)) as Node;
}

export function cloneVariant(v: Variant): Variant {
  return JSON.parse(JSON.stringify(v)) as Variant;
}

export function clonePage(p: Page): Page {
  return JSON.parse(JSON.stringify(p)) as Page;
}
