import { afterEach, describe, expect, test } from "bun:test";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import { updateProps } from "../index.ts";

/**
 * `propPatch` sets each prop whole — the canvas inspector writes the complete
 * `style` object on every edit and relies on that to delete a key — so the
 * writes that probably weren't meant come back as warnings, not as changes.
 */

const page: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { style: { width: "100%", margin: "0 auto" } },
    children: [],
  },
};

let t: TestContext;
afterEach(() => t.cleanup());

describe("update_props warnings", () => {
  test("an object prop replaced whole names the keys it dropped", async () => {
    t = await testContext({ label: "update-props-warn", screens: { home: page } });
    const result = unwrap(
      await updateProps(t.ctx, {
        screenId: "home",
        patches: [{ path: [], propPatch: { style: { maxWidth: 1104 } } }],
      }),
    );
    // The semantics stay replacement; the agent is told what that cost.
    expect(t.ctx.folder.screens.get("home")?.tree).toMatchObject({
      props: { style: { maxWidth: 1104 } },
    });
    expect(result.warnings).toEqual([expect.stringContaining("dropping `width`, `margin`")]);
    // A Tailwind screen's `style` channel is className, so it can't be the fix.
    expect(result.warnings?.[0]).toContain("include every key you want to keep");
  });

  test("points at the merging `style` channel where it writes that prop", async () => {
    t = await testContext({
      label: "update-props-warn",
      provider: createNoneProvider(),
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
      }),
      screens: { home: page },
    });
    const result = unwrap(
      await updateProps(t.ctx, {
        screenId: "home",
        patches: [{ path: [], propPatch: { style: { maxWidth: 1104 } } }],
      }),
    );
    expect(result.warnings?.[0]).toContain("which merges key by key");
  });

  test("keeping every key, or clearing the prop, is not a warning", async () => {
    t = await testContext({ label: "update-props-warn", screens: { home: page } });
    const kept = unwrap(
      await updateProps(t.ctx, {
        screenId: "home",
        patches: [
          { path: [], propPatch: { style: { width: "100%", margin: "0 auto", maxWidth: 1104 } } },
        ],
      }),
    );
    expect(kept.warnings).toBeUndefined();
    const cleared = unwrap(
      await updateProps(t.ctx, {
        screenId: "home",
        patches: [{ path: [], propPatch: { style: null } }],
      }),
    );
    expect(cleared.warnings).toBeUndefined();
  });

  test("an empty propPatch says nothing changed", async () => {
    t = await testContext({ label: "update-props-warn", screens: { home: page } });
    const result = unwrap(
      await updateProps(t.ctx, { screenId: "home", patches: [{ path: [], propPatch: {} }] }),
    );
    expect(result.warnings).toEqual(["[] propPatch is empty — nothing changed on this node."]);
  });
});
