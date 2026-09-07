import { describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
import { renderDiagnostics } from "../diagnostics.ts";

function screenWith(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

/**
 * The render guard keeps a broken component from taking the screen down, which
 * means a mutation that produced one succeeds. Without a diagnostic the agent
 * that composed it is told nothing is wrong — it would have to screenshot and
 * look at the picture to find out otherwise.
 */
describe("renderDiagnostics", () => {
  test("reports a component that threw, at the path that used it", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 2, children: "Settings" } },
        { $ref: "TabsTrigger", props: { value: "one", children: "One" } },
      ],
    });

    const diagnostics = renderDiagnostics(ctx, screen);
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic?.code).toBe("render/component-threw");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.path).toEqual([1]);
    expect(diagnostic?.message).toContain("TabsTrigger");
    // The component's own words, so the agent learns what it needs.
    expect(diagnostic?.message).toContain("Tabs");
  });

  test("a healthy screen produces nothing", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "Heading", props: { level: 2, children: "Settings" } },
        { $ref: "Button", props: { children: "Save" } },
      ],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([]);
  });

  test("a correctly-nested context consumer is not reported", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Tabs",
      props: { defaultValue: "one" },
      children: [
        {
          $ref: "TabsList",
          children: [{ $ref: "TabsTrigger", props: { value: "one", children: "One" } }],
        },
      ],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([]);
  });

  test("every use of a broken component gets its own path", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [
        { $ref: "TabsTrigger", props: { value: "a", children: "A" } },
        {
          $ref: "Box",
          children: [{ $ref: "TabsTrigger", props: { value: "b", children: "B" } }],
        },
      ],
    });
    expect(renderDiagnostics(ctx, screen).map((d) => d.path)).toEqual([[0], [1, 0]]);
  });

  test("an unknown $ref is left to the error that already covers it", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [{ $ref: "NoSuchComponent", props: {} }],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([]);
  });
});
