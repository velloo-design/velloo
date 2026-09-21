import { describe, expect, test } from "bun:test";
import type { Node, Screen } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
import { rawColorDiagnostics, renderDiagnostics } from "../diagnostics.ts";

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

  /**
   * The screen draws now, so this is the only thing that tells the agent at
   * all: the whole-screen refusal that used to make a bad `$ref` obvious is
   * gone, and what is left on the canvas is one dashed box among many.
   */
  test("an unknown $ref is reported as missing, not as a component that threw", async () => {
    const { ctx } = await testContext();
    const screen = screenWith({
      $ref: "Card",
      children: [{ $ref: "NoSuchComponent", props: {} }],
    });
    expect(renderDiagnostics(ctx, screen)).toEqual([
      {
        severity: "error",
        code: "render/component-missing",
        path: [0],
        message: expect.stringContaining("`NoSuchComponent` is not in this screen's library"),
      },
    ]);
  });
});

/**
 * The audit itself is covered in `dark-mode-audit`; what matters here is what
 * an agent actually receives when a whole hero section is white-on-photo.
 */
describe("rawColorDiagnostics", () => {
  const hero = (count: number): Node => ({
    $ref: "Box",
    props: { className: "relative" },
    children: Array.from({ length: count }, (_, i) => ({
      $ref: "Text",
      $id: `line-${i}`,
      props: { className: "text-white" },
    })),
  });

  test("lists every offender while the list is still a list of things to fix", () => {
    const out = rawColorDiagnostics(hero(3));
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.code === "theme/raw-color")).toBe(true);
    expect(out.some((d) => d.message.includes("more node(s)"))).toBe(false);
  });

  test("caps the repetition and names the opt-out once", () => {
    const out = rawColorDiagnostics(hero(30));
    // Eight worked examples, then one line that says what to do about the rest.
    expect(out).toHaveLength(9);
    const summary = out.at(-1);
    expect(summary?.message).toContain("22 more node(s)");
    expect(summary?.message).toContain("data-accent");
    // Named where it is read: the guide had it, the warning did not.
    expect(summary?.message).toContain("does not cascade");
    expect(summary?.suggestion).toBeUndefined();
  });

  test("an exempted node produces nothing, cap or no cap", () => {
    const tree: Node = {
      $ref: "Box",
      children: [
        { $ref: "Text", $id: "t", props: { className: "text-white", "data-accent": "ok" } },
      ],
    };
    expect(rawColorDiagnostics(tree)).toEqual([]);
  });
});
