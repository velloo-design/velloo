import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";

/**
 * `$emitAs` is the host-component facade (framework-native scan/import): the
 * canvas renders the agent's approximation subtree, but emit_code emits the
 * app's real component import instead. See ComponentNode.$emitAs.
 */

describe("emitCode $emitAs (host component)", () => {
  test("emits the host import, not the approximation subtree", async () => {
    const screen: Screen = {
      id: "s",
      name: "S",
      tree: {
        $ref: "Box",
        props: { className: "p-4" },
        children: [
          {
            // The agent's faithful approximation of the app's <DataTable>.
            $ref: "Card",
            props: { className: "rounded border" },
            children: [{ $ref: "Text", props: { children: "rows…" } }],
            $emitAs: { name: "DataTable", importPath: "@/components/data-table" },
          },
        ],
      },
    };
    const result = unwrap(await emitCode(screen));
    // The real component is emitted, self-closing — its data-bound props live in
    // the app, not the design.
    expect(result.jsx).toContain("<DataTable />");
    // The approximation subtree is NOT emitted in its place.
    expect(result.jsx).not.toContain("rows…");
    expect(result.jsx).not.toContain("rounded border");
  });
});
