import { describe, expect, test } from "bun:test";
import { registry as noneRegistry } from "@velloo/provider-none";
import { loadManifest, registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import { REGISTRY } from "../component-registry.ts";

/**
 * Every component a shipping provider can render must be emittable.
 * This is the seam a production-like dogfood session found broken: the
 * snapshot grew to ~35 shadcn primitives but codegen's REGISTRY kept
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

  /**
   * Coverage alone lets an id sit under the *wrong* file, which is worse than
   * a missing one: `importFile` is what `shadcnInstallTargets` puts after
   * `npx shadcn add`, so a misfiling tells the user to install some other
   * component and emits an import from a file that never exports the name.
   * The snapshot build records the true file as `registryName` — that is the
   * one source, and this is the only thing holding the hand-written copy to it.
   */
  test("every shadcn entry imports from the file the snapshot puts it in", async () => {
    const registryName = new Map(
      (await loadManifest()).flatMap((c) =>
        c.registryName ? [[c.id, c.registryName] as const] : [],
      ),
    );
    const misfiled = Object.entries(REGISTRY).flatMap(([id, entry]) => {
      if (entry.kind !== "shadcn" || entry.importFile.startsWith("velloo/")) return [];
      const truth = registryName.get(id);
      if (truth === undefined || truth === entry.importFile) return [];
      return [`${id}: codegen imports from ${entry.importFile}, snapshot ships it in ${truth}`];
    });
    expect(misfiled).toEqual([]);
  });
});
