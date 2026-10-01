import { describe, expect, test } from "bun:test";
import { registry as noneRegistry } from "@velloo/provider-none";
import { loadManifest, registry as snapshotRegistry } from "@velloo/shadcn-snapshot";
import { REGISTRY_FILES } from "@velloo/shadcn-snapshot/registry-files";
import { emitCode } from "../emit-code/index.ts";
import { shadcnTarget } from "./shadcn-target.ts";

/**
 * Every component a shipping provider can render must be emittable.
 * This is the seam a production-like dogfood session found broken: the
 * snapshot grew to ~35 shadcn primitives but codegen's registry kept
 * the original 12, so screens rendered + audited green and then failed
 * emit_code with UnknownComponent. Renders-green-but-can't-emit is the
 * worst failure shape for the agent loop — keep this exhaustive.
 *
 * Here that is checked for the two providers codegen can reach as devDependencies;
 * `packages/server/src/__tests__/emit-frameworks.test.ts` does it for all six
 * through the real provider resolution.
 */
describe("the emit chain covers every shipping provider component", () => {
  async function unemittable(
    ids: string[],
    options: Parameters<typeof emitCode>[1],
  ): Promise<string[]> {
    const out: string[] = [];
    for (const ref of ids) {
      const result = await emitCode({ id: "s", name: "S", tree: { $ref: ref } }, options);
      if (!result.ok) out.push(ref);
    }
    return out;
  }

  test("every shadcn-snapshot registry id emits under the shadcn target", async () => {
    expect(await unemittable(Object.keys(snapshotRegistry), { target: shadcnTarget() })).toEqual(
      [],
    );
  });

  test("every provider-none registry id emits on both of its channels", async () => {
    const ids = Object.keys(noneRegistry);
    // No target at all: a no-library folder's components are velloo's own, so
    // the velloo primitives alone must cover them.
    expect(await unemittable(ids, {})).toEqual([]);
    expect(await unemittable(ids, { inlineStyle: true })).toEqual([]);
  });

  /**
   * The snapshot build records the registry item each id ships in as
   * `registryName`, and that is what the server's `codegenTargetFor` reads to
   * build the install plan. `REGISTRY_FILES` is generated from the same field
   * for the canvas; this holds the two to each other, so a target built from
   * either tells the user to install the same component.
   */
  test("REGISTRY_FILES and the manifest agree on which item ships each id", async () => {
    const fromManifest = Object.fromEntries(
      (await loadManifest()).flatMap((c) => (c.registryName ? [[c.id, c.registryName]] : [])),
    );
    expect(fromManifest).toEqual(REGISTRY_FILES);
  });
});
