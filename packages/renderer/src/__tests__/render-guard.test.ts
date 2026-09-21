import { describe, expect, test } from "bun:test";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import { registry } from "@velloo/shadcn-snapshot";
import { RenderGuardLimitError, renderBody, renderScreen, UnknownSnippetError } from "../index.ts";

const viewport: Viewport = { w: 800, h: 600 };
const opts = { snapshotCss: "/* stub */", viewport, registry };

const sampleTheme: Theme = {
  name: "test",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.5 0.2 250)", foreground: "oklch(0.985 0 0)" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 8 },
};

function screenWith(tree: Screen["tree"]): Screen {
  return { id: "test", name: "Test", tree };
}

/**
 * `TabsTrigger` reads the context `Tabs` provides and throws without it — the
 * same shape as the bare `SelectTrigger` that used to blank two screens. It
 * stands in for the whole class here: a real component, failing the way designs
 * actually break, rather than a throwing stub that proves only the plumbing.
 */
const ORPHANED_TRIGGER = { $ref: "TabsTrigger", props: { children: "Overview" } };

describe("a component that throws", () => {
  test("is replaced by a stand-in, and the rest of the screen still renders", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: [
        { $ref: "Heading", props: { level: 1, children: "Settings" } },
        ORPHANED_TRIGGER,
        { $ref: "Text", props: { children: "Everything after the break" } },
      ],
    });

    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);

    // The siblings are the point: one bad node used to cost the whole screen.
    expect(bodyHtml).toContain("Settings");
    expect(bodyHtml).toContain("Everything after the break");
    expect(bodyHtml).toContain('data-velloo-render-error="TabsTrigger"');
    expect(failures).toEqual([
      {
        componentId: "TabsTrigger",
        reason: expect.stringContaining("must be used within"),
        kind: "threw",
      },
    ]);
  });

  test("says which component failed and why, in the frame itself", async () => {
    const { bodyHtml } = await renderScreen(screenWith(ORPHANED_TRIGGER), sampleTheme, opts);
    expect(bodyHtml).toContain("TabsTrigger failed to render");
    expect(bodyHtml).toContain("must be used within");
  });

  /**
   * The stand-in is asking to be fixed or deleted, and both are canvas actions
   * that address a node by path — so it has to stay selectable.
   */
  test("stays selectable at the node path it replaced", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: [{ $ref: "Text", props: { children: "first" } }, ORPHANED_TRIGGER],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain('data-node-path="1"');
  });

  test("is contained per component, so two breakages both render", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: [ORPHANED_TRIGGER, { $ref: "AvatarImage", props: {} }],
    });
    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);
    expect(failures.map((failure) => failure.componentId).sort()).toEqual([
      "AvatarImage",
      "TabsTrigger",
    ]);
    expect(bodyHtml).toContain('data-velloo-render-error="TabsTrigger"');
    expect(bodyHtml).toContain('data-velloo-render-error="AvatarImage"');
  });

  test("past the stand-in cap, the error names the cap and carries every failure", async () => {
    const orphans = [
      "TabsTrigger",
      "TabsList",
      "TabsContent",
      "AccordionItem",
      "AccordionContent",
      "AvatarImage",
      "AvatarFallback",
      "PopoverTrigger",
      "PopoverAnchor",
    ];
    const screen = screenWith({
      $ref: "Box",
      children: orphans.map(($ref) => ({ $ref, props: { value: "a" } })),
    });
    const error = await renderScreen(screen, sampleTheme, opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderGuardLimitError);
    const limit = error as RenderGuardLimitError;
    expect(limit.message).toContain("more than the 8");
    expect(limit.failures.map((failure) => failure.componentId).sort()).toEqual(orphans.sort());
  });

  test("renderBody contains it too — inspect answers instead of throwing", () => {
    const html = renderBody(screenWith(ORPHANED_TRIGGER), registry);
    expect(html).toContain('data-velloo-render-error="TabsTrigger"');
  });
});

/**
 * A `$ref` naming nothing is the failure a folder actually accumulates —
 * a component renamed in the app, or an agent writing the name of one it never
 * registered. It used to take the whole screen down with it, which cost the
 * canvas its one way of pointing at the node: no elements, so nothing to
 * select, locate, or delete from the frame.
 */
describe("a $ref that names nothing", () => {
  const MISSING = { $ref: "SiteHeader" };

  test("is stood in for, and the rest of the screen still renders", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: [MISSING, { $ref: "Text", props: { children: "the rest of the page" } }],
    });

    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);

    expect(bodyHtml).toContain("the rest of the page");
    // The apostrophe in "screen's" arrives HTML-escaped, as it should.
    expect(bodyHtml).toContain("SiteHeader is not in this screen");
    expect(failures).toEqual([
      {
        componentId: "SiteHeader",
        reason: expect.stringContaining('Unknown component $ref="SiteHeader"'),
        kind: "missing",
      },
    ]);
  });

  /**
   * The opposite of the throwing case, and for the opposite reason: there is no
   * context here to be missing, so the children are ordinary nodes that render
   * fine — and every one of them is a row in the tree that has to stay
   * selectable.
   */
  test("keeps its children, and their paths with them", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: [{ ...MISSING, children: [{ $ref: "Text", props: { children: "inner-label" } }] }],
    });
    const { bodyHtml } = await renderScreen(screen, sampleTheme, opts);
    expect(bodyHtml).toContain("inner-label");
    expect(bodyHtml).toContain('data-node-path="0.0"');
  });

  test("renders even as the whole screen, where there is no rest to save", async () => {
    const { bodyHtml, failures } = await renderScreen(screenWith(MISSING), sampleTheme, opts);
    expect(bodyHtml).toContain('data-velloo-render-error="SiteHeader"');
    expect(failures).toHaveLength(1);
  });

  test("is contained once per name, however many rows use it", async () => {
    const screen = screenWith({ $ref: "Box", children: [MISSING, MISSING, MISSING] });
    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);
    expect(failures).toHaveLength(1);
    expect(bodyHtml.match(/data-velloo-render-error="SiteHeader"/g)).toHaveLength(3);
  });

  test("counts against the same cap as a throw", async () => {
    const screen = screenWith({
      $ref: "Box",
      children: Array.from({ length: 9 }, (_, i) => ({ $ref: `Missing${i}` })),
    });
    const error = await renderScreen(screen, sampleTheme, opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderGuardLimitError);
  });
});

describe("what the guard leaves alone", () => {
  /**
   * The boundary the guard still can't cross: an error that names no node at
   * all has nothing to stand in for, so the route draws its error document.
   */
  test("a $snippet that names nothing throws — there is no node to replace", async () => {
    const screen = screenWith({ $ref: "Box", children: [{ $snippet: "not-a-snippet" }] });
    await expect(renderScreen(screen, sampleTheme, opts)).rejects.toBeInstanceOf(
      UnknownSnippetError,
    );
  });

  test("a clean screen reports no failures and gains no markup", async () => {
    const screen = screenWith({ $ref: "Button", props: { children: "Click me" } });
    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);
    expect(failures).toEqual([]);
    expect(bodyHtml).not.toContain("data-velloo-render-error");
    expect(bodyHtml).toContain("Click me");
  });

  test("a component nested inside the failing one goes with it, not around it", async () => {
    // The stand-in renders no children: they were built for a parent that is no
    // longer there, and anything reading its context would throw in turn.
    const screen = screenWith({
      $ref: "TabsTrigger",
      children: [{ $ref: "Text", props: { children: "inner-label" } }],
    });
    const { bodyHtml, failures } = await renderScreen(screen, sampleTheme, opts);
    expect(failures).toHaveLength(1);
    expect(bodyHtml).not.toContain("inner-label");
    expect(bodyHtml).toContain("TabsTrigger failed to render");
  });
});
