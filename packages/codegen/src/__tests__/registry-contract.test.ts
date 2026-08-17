import { describe, expect, test } from "bun:test";
import { registry as noneRegistry } from "@velloo/provider-none";
import { registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import { REGISTRY } from "../component-registry.ts";

/**
 * Every component a shipping provider can render must be emittable.
 * This is the seam the sample app dogfood (2026-06-11) found broken: Sprint J
 * grew the snapshot to ~35 shadcn primitives but codegen's REGISTRY kept
 * the original 12, so screens rendered + audited green and then failed
 * emit_code with UnknownComponent. Renders-green-but-can't-emit is the
 * worst failure shape for the agent loop — keep this exhaustive.
 */
describe("codegen registry covers every shipping provider component", () => {
  test("every shadcn-snapshot registry id has a codegen entry", () => {
    const missing = Object.keys(snapshotRegistry).filter((id) => !(id in REGISTRY));
    expect(missing).toEqual([]);
  });

  test("every provider-none registry id has a codegen entry", () => {
    const missing = Object.keys(noneRegistry).filter((id) => !(id in REGISTRY));
    expect(missing).toEqual([]);
  });
});
