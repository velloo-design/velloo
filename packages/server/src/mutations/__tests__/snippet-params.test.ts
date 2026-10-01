import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Snippet } from "@velloo/schema";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { addSnippet } from "../add-snippet.ts";
import { updateSnippet } from "../update-snippet.ts";

/**
 * A param compose can never pass makes the snippet unplaceable: `<Row ref="…">`
 * is refused as an executable React attribute before the snippet is consulted.
 */

let t: TestContext;

beforeEach(async () => {
  t = await testContext({
    label: "snippet-params",
    snippets: {
      row: { id: "row", name: "Row", params: [], tree: { $ref: "Box" } } as Snippet,
    },
  });
});

afterEach(() => t.cleanup());

describe("reserved snippet param names", () => {
  test.each(["ref", "key", "onClick", "vellooId"])(
    "add_snippet refuses a param named %s",
    async (name) => {
      const result = await addSnippet(t.ctx, {
        name: "Shipment row",
        params: [{ name, type: "string" }],
        tree: { $ref: "Box" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("SnippetParamMismatch");
      expect(JSON.stringify(result.error)).toContain(`Reserved param name: \\"${name}\\"`);
      expect(t.ctx.folder.snippets.has("shipment-row")).toBe(false);
    },
  );

  test("update_snippet refuses one too, and names a rename", async () => {
    const result = await updateSnippet(t.ctx, {
      snippetId: "row",
      patch: { params: [{ name: "ref", type: "string" }] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("refId");
  });

  test("an ordinary name is fine", async () => {
    const result = await addSnippet(t.ctx, {
      name: "Shipment row",
      params: [{ name: "shipmentRef", type: "string" }],
      tree: { $ref: "Box" },
    });
    expect(result.ok).toBe(true);
  });
});
