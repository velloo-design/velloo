import { describe, expect, test } from "bun:test";
import type { Node } from "@velloo/schema";
import { resolve } from "../lookup.ts";

/**
 * JSX written for an app names its inputs with `id="email"`, and an agent then
 * addresses them as `@email` — the stable `$id`, which compose takes from
 * `vellooId`. Sonnet 5.5 made four such calls in one run before it walked the
 * outline for paths.
 */
const tree: Node = {
  $ref: "Box",
  children: [
    { $ref: "Text", props: { children: "Sign up" } },
    { $ref: "Box", children: [{ $ref: "Input", props: { id: "email", type: "email" } }] },
  ],
};

describe("an @id nothing has", () => {
  test("points at the node whose HTML id it is, and how to address it", () => {
    const r = resolve(tree, "@email", "signup");
    expect(r.ok).toBe(false);
    if (r.ok || r.error.kind !== "IdNotFound") throw new Error("expected IdNotFound");
    expect(r.error.hint).toContain("[1,0]");
    expect(r.error.hint).toContain('set_node_id { path: [1,0], id: "email" }');
    expect(r.error.hint).toContain('vellooId="email"');
  });

  test("with no such attribute either, carries no hint", () => {
    const r = resolve(tree, "@password", "signup");
    if (r.ok || r.error.kind !== "IdNotFound") throw new Error("expected IdNotFound");
    expect(r.error.hint).toBeUndefined();
  });
});
