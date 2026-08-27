import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Snippet, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import type { MutationContext } from "../index.ts";
import { overrideSnippetProps } from "../override-snippet-props.ts";

const provider = createShadcnProvider();

const tipCard: Snippet = {
  id: "tip",
  name: "Tip",
  params: [{ name: "title", type: "string", default: "Tip" }],
  tree: {
    $ref: "Card",
    children: [
      { $ref: "Heading", props: { level: 4, children: { $param: "title" } } },
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
      children: [{ $snippet: "tip", $id: "tip-1", args: { title: "Hello" } }],
    },
  };
  const folder = {
    root: "/tmp/velloo-override-test-nonexistent",
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

describe("overrideSnippetProps", () => {
  test("writes an override targeting an interior node by @id locator", async () => {
    const { ctx } = ctxOf();
    const r = unwrap(
      await overrideSnippetProps(ctx, {
        screenId: "home",
        path: "@tip-1",
        innerPath: "1",
        propPatch: { variant: "destructive" },
      }),
    );
    expect(r.overrides).toEqual({ "1": { props: { variant: "destructive" } } });
    const tree = ctx.folder.screens.get("home")?.tree;
    const instance = tree && "children" in tree ? tree.children?.[0] : undefined;
    expect(instance).toMatchObject({
      $snippet: "tip",
      $overrides: { "1": { props: { variant: "destructive" } } },
    });
  });

  test("null values remove keys; empty patches clear the override entry", async () => {
    const { ctx } = ctxOf();
    await overrideSnippetProps(ctx, {
      screenId: "home",
      path: "@tip-1",
      innerPath: "1",
      propPatch: { variant: "destructive" },
    });
    const cleared = unwrap(
      await overrideSnippetProps(ctx, {
        screenId: "home",
        path: "@tip-1",
        innerPath: "1",
        propPatch: { variant: null },
      }),
    );
    expect(cleared.overrides).toEqual({});
    const tree = ctx.folder.screens.get("home")?.tree;
    const instance = (tree && "children" in tree ? tree.children?.[0] : undefined) as Record<
      string,
      unknown
    >;
    expect(instance.$overrides).toBeUndefined();
  });

  test("rejects non-instance targets and unresolvable inner paths", async () => {
    const { ctx } = ctxOf();
    const notInstance = await overrideSnippetProps(ctx, {
      screenId: "home",
      path: [],
      innerPath: "0",
      propPatch: { x: 1 },
    });
    expect(notInstance.ok).toBe(false);

    const badInner = await overrideSnippetProps(ctx, {
      screenId: "home",
      path: "@tip-1",
      innerPath: "9.9",
      propPatch: { x: 1 },
    });
    expect(badInner.ok).toBe(false);

    const badFormat = await overrideSnippetProps(ctx, {
      screenId: "home",
      path: "@tip-1",
      innerPath: "a.b",
      propPatch: { x: 1 },
    });
    expect(badFormat.ok).toBe(false);
  });
});
