import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Snippet, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import type { MutationContext } from "../index.ts";
import { inspect } from "../inspect.ts";

const provider = createShadcnProvider();

const tipCard: Snippet = {
  id: "tip",
  name: "Tip",
  params: [{ name: "title", type: "string", default: "Tip" }],
  tree: {
    $ref: "Card",
    props: { className: "p-4" },
    children: [
      { $ref: "Heading", $id: "tip-title", props: { level: 4, children: { $param: "title" } } },
      { $ref: "Badge", props: { variant: "secondary", children: "info" } },
    ],
  },
};

function ctxOf(): { ctx: MutationContext; screen: Screen } {
  const screen: Screen = {
    id: "home",
    name: "Home",
    tree: {
      $ref: "Card",
      children: [
        { $ref: "Button", props: { className: "px-4 font-bold", children: "Go" } },
        { $snippet: "tip", $id: "tip-1", args: { title: "Hello" } },
      ],
    },
  };
  const folder = {
    root: "/tmp/velloo-inspect-test-nonexistent",
    config: {
      schemaVersion: 2,
      toolVersion: "test",
      libraries: {
        default: {
          id: "shadcn-upstream",
          version: "t",
          source: "binary",
          componentsPath: "binary",
        },
      },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    },
    theme: {
      name: "t",
      colors: {
        background: "#fff",
        foreground: "#000",
        primary: { DEFAULT: "#000", foreground: "#fff" },
      },
      typography: {},
      spacing: {},
      radius: {},
    } as Theme,
    history: new HistoryManager(),
    customCss: "",
    themes: new Map(),
    screens: new Map([[screen.id, screen]]),
    boards: new Map(),
    snippets: new Map([[tipCard.id, tipCard]]),
    annotations: new Map(),
    notes: new Map(),
  } as DesignFolder;
  return {
    ctx: {
      folder,
      providers: { default: provider },
      defaultProvider: provider,
      broadcast: () => {},
    },
    screen,
  };
}

describe("inspect", () => {
  test("inspects a plain component node (no regression)", async () => {
    const { ctx } = ctxOf();
    const r = unwrap(await inspect(ctx, { screenId: "home", path: [0] }));
    expect(r.ref).toBe("Button");
    expect(r.classes).toContain("px-4");
    expect(r.classes).toContain("font-bold");
    expect(r.bodyHtml).toContain("Go");
    expect(r.note).toBeUndefined();
  });

  test("inspecting a snippet instance with no innerPath returns the body root + hint", async () => {
    const { ctx } = ctxOf();
    const r = unwrap(await inspect(ctx, { screenId: "home", path: "@tip-1" }));
    expect(r.ref).toBe("Card");
    expect(r.classes).toContain("p-4");
    // Whole body renders, so the substituted param shows through.
    expect(r.bodyHtml).toContain("Hello");
    expect(r.bodyHtml).toContain("info");
    expect(r.note).toContain("body root");
  });

  test("inspects a node inside the body by @id", async () => {
    const { ctx } = ctxOf();
    const r = unwrap(
      await inspect(ctx, { screenId: "home", path: "@tip-1", innerPath: "@tip-title" }),
    );
    expect(r.ref).toBe("Heading");
    // Param was substituted from the instance args.
    expect(r.bodyHtml).toContain("Hello");
    expect(r.bodyHtml).not.toContain("info");
    expect(r.note).toContain("@tip-title");
  });

  test("inspects a node inside the body by dotted index", async () => {
    const { ctx } = ctxOf();
    const r = unwrap(await inspect(ctx, { screenId: "home", path: "@tip-1", innerPath: "1" }));
    expect(r.ref).toBe("Badge");
    expect(r.bodyHtml).toContain("info");
    expect(r.resolvedProps.variant).toBe("secondary");
  });

  test("applied $override is reflected in the inspected HTML", async () => {
    const { ctx, screen } = ctxOf();
    // Patch the Badge inside the instance to a destructive variant.
    const tree = screen.tree as unknown as { children: Record<string, unknown>[] };
    const badge = tree.children[1];
    if (!badge) throw new Error("fixture missing inner node");
    badge.$overrides = { "1": { props: { variant: "destructive", children: "ALERT" } } };

    const r = unwrap(await inspect(ctx, { screenId: "home", path: "@tip-1", innerPath: "1" }));
    expect(r.ref).toBe("Badge");
    expect(r.resolvedProps.variant).toBe("destructive");
    expect(r.bodyHtml).toContain("ALERT");
    expect(r.bodyHtml).not.toContain("info");
  });

  test("$extraClassName is merged onto the inspected body root", async () => {
    const { ctx, screen } = ctxOf();
    const tree = screen.tree as unknown as { children: Record<string, unknown>[] };
    const badge = tree.children[1];
    if (!badge) throw new Error("fixture missing inner node");
    badge.$extraClassName = "border-accent";

    const r = unwrap(await inspect(ctx, { screenId: "home", path: "@tip-1" }));
    expect(r.classes).toContain("p-4");
    expect(r.classes).toContain("border-accent");
  });

  test("unresolvable innerPath returns a precise error", async () => {
    const { ctx } = ctxOf();
    const r = await inspect(ctx, { screenId: "home", path: "@tip-1", innerPath: "9.9" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidPath");
      expect(JSON.stringify(r.error)).toContain("tip");
    }
  });

  test("innerPath on a non-instance node errors", async () => {
    const { ctx } = ctxOf();
    const r = await inspect(ctx, { screenId: "home", path: [0], innerPath: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidPath");
  });
});
