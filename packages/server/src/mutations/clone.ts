import type { Node, Screen } from "@velloo/schema";

/** Deep clone a Node tree. Cheap because trees are small JSON. */
export function cloneNode(n: Node): Node {
  return JSON.parse(JSON.stringify(n)) as Node;
}

export function cloneScreen(s: Screen): Screen {
  return JSON.parse(JSON.stringify(s)) as Screen;
}
