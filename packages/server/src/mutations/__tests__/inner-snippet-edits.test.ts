import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Snippet, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import type { MutationContext } from "../index.ts";
import { updateProps } from "../update-props.ts";
import { updateSnippet } from "../update-snippet.ts";

const provider = createShadcnProvider();

// A sidebar snippet with an interior node carrying a $id — the shape the
// field-feedback agent hit when reaching for `update_props @nav-errors`.
const sidebar: Snippet = {
  id: "sidebar",
  name: "Sidebar",
  params: [],
  tree: {
    $ref: "Box",
    children: [
      { $ref: "Badge", $id: "nav-errors", props: { variant: "secondary", children: "Errors" } },
    ],
  },
};

function ctxOf(root: string): { ctx: MutationContext; screen: Screen } {
  const screen: Screen = {
    id: "home",
    name: "Home",
    tree: { $ref: "Box", children: [{ $snippet: "sidebar", $id: "app-sidebar" }] },
  };
  const folder = {
    root,
    config: {
      schemaVersion: 4,
      name: "test",
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
    snippets: new Map([[sidebar.id, { ...sidebar, tree: structuredClone(sidebar.tree) }]]),
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

describe("update_snippet innerPatch", () => {
  test("patches one body node's props in place without resending the tree", async () => {
    const { ctx } = ctxOf("/tmp/velloo-inner-edit-1");
    const r = unwrap(
      await updateSnippet(ctx, {
        snippetId: "sidebar",
        patch: { innerPatch: { innerPath: "@nav-errors", propPatch: { variant: "destructive" } } },
      }),
    );
    const tree = r.snippet.tree as { children?: { props?: Record<string, unknown> }[] };
    const badge = tree.children?.[0];
    expect(badge?.props?.variant).toBe("destructive");
    // children left untouched — it was a shallow merge.
    expect(badge?.props?.children).toBe("Errors");
  });

  test("null in propPatch removes the key", async () => {
    const { ctx } = ctxOf("/tmp/velloo-inner-edit-2");
    const r = unwrap(
      await updateSnippet(ctx, {
        snippetId: "sidebar",
        patch: { innerPatch: { innerPath: "@nav-errors", propPatch: { children: null } } },
      }),
    );
    const tree = r.snippet.tree as { children?: { props?: Record<string, unknown> }[] };
    const badge = tree.children?.[0];
    expect(badge?.props?.children).toBeUndefined();
  });

  test("rejects an innerPath that doesn't resolve", async () => {
    const { ctx } = ctxOf("/tmp/velloo-inner-edit-3");
    const bad = await updateSnippet(ctx, {
      snippetId: "sidebar",
      patch: { innerPatch: { innerPath: "@nope", propPatch: { variant: "destructive" } } },
    });
    expect(bad.ok).toBe(false);
  });
});

describe("update_props on an inner-instance id", () => {
  test("IdNotFound carries a hint pointing at update_snippet_instance", async () => {
    const { ctx } = ctxOf("/tmp/velloo-inner-edit-4");
    const r = await updateProps(ctx, {
      screenId: "home",
      patches: [{ path: "@nav-errors", propPatch: { variant: "destructive" } }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.kind).toBe("IdNotFound");
    const hint = (r.error as { hint?: string }).hint ?? "";
    expect(hint).toContain("update_snippet_instance");
    expect(hint).toContain("@app-sidebar");
    expect(hint).toContain("@nav-errors");
  });
});
