import type { ComponentNode, Extension, NodeShape } from "@velloo/schema";
import { nodeShape } from "@velloo/schema";

/**
 * What a node is, all the way down: the structural shape its own fields give
 * it (`@velloo/schema`'s `nodeShape`) with a plain name resolved against the
 * folder's extensions and the screen's library.
 *
 * A velloo helper (Box, Heading, Text, …) arrives as `component`: every
 * provider folds `helpersRegistry` into its registry, so nothing downstream
 * dispatches on the difference — a descriptor's `source` is where provenance
 * lives.
 *
 * `Entry` is whatever the library lookup hands back — a React component for
 * the renderer, a codegen lowering for `emit_code` — so a walker never looks
 * the name up a second time with different semantics.
 */
export type NodeIdentity<Entry = unknown> =
  | Exclude<NodeShape, { kind: "named" }>
  /** A component the folder declares in `config.extensions`. */
  | { kind: "extension"; node: ComponentNode; ref: string; extension: Extension }
  | { kind: "component"; node: ComponentNode; ref: string; entry: Entry }
  /** A name neither the extensions nor the library supply. */
  | { kind: "unresolved"; node: ComponentNode; ref: string };

/**
 * The screen's library: a registry object, or a function for a caller that
 * resolves a name some other way (codegen consults a framework target, an
 * inline lowering that reads the node's props, then a static registry).
 */
export type LibraryLookup<Entry> =
  | Readonly<Record<string, Entry>>
  | ((ref: string, node: ComponentNode) => Entry | undefined);

export interface NodeIdentityContext<Entry> {
  extensions?: Readonly<Record<string, Extension>> | undefined;
  library: LibraryLookup<Entry>;
}

/**
 * A record's own entry for a key. Design JSON names the key, so a `$ref` of
 * `toString` or `constructor` must not resolve off a plain object's prototype.
 */
export function ownEntry<Entry>(
  record: Readonly<Record<string, Entry>>,
  key: string,
): Entry | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function lookup<Entry>(
  library: LibraryLookup<Entry>,
  ref: string,
  node: ComponentNode,
): Entry | undefined {
  return typeof library === "function" ? library(ref, node) : ownEntry(library, ref);
}

/**
 * Resolve a value in a node position to exactly one identity. Takes `unknown`
 * because a node position is a trust boundary — design JSON reaches here from
 * disk, from MCP arguments and from inside a prop value.
 *
 * Past the structural order `nodeShape` decides, an extension is consulted
 * before the library: `add_extension` reports the library component a new id
 * shadows and `registryForScreen` merges extensions over the library, so an
 * explicitly registered component wins over a library default of the same name.
 */
export function resolveNodeIdentity<Entry>(
  value: unknown,
  ctx: NodeIdentityContext<Entry>,
): NodeIdentity<Entry> {
  const shape = nodeShape(value);
  if (shape.kind !== "named") return shape;
  const { node, ref } = shape;
  const extension = ctx.extensions ? ownEntry(ctx.extensions, ref) : undefined;
  if (extension) return { kind: "extension", node, ref, extension };
  const entry = lookup(ctx.library, ref, node);
  if (entry === undefined) return { kind: "unresolved", node, ref };
  return { kind: "component", node, ref, entry };
}
