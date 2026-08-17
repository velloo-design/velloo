import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../../design-folder.ts";
import { HistoryManager } from "../../history.ts";
import { findNodes } from "../find-nodes.ts";
import type { MutationContext } from "../index.ts";

const provider = createShadcnProvider();

function blankTheme(): Theme {
  return {
    name: "t",
    colors: {
      background: "#fff",
      foreground: "#000",
      primary: { DEFAULT: "#000", foreground: "#fff" },
    },
    typography: {},
    spacing: {},
    radius: {},
  };
}

const screen: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Card",
    props: { className: "p-4 flex" },
    children: [
      { $ref: "Heading", $id: "title", props: { level: 1, children: "Hello world" } },
      { $ref: "Icon", props: { name: "Github", className: "size-4" } },
      { $ref: "Icon", props: { name: "Sparkles" } },
      {
        $ref: "Card",
        props: { className: "grid gap-2" },
        children: [{ $snippet: "tip-card", args: { title: "x" } }, { $param: "slot" }],
      },
    ],
  },
};

function ctxOf(): MutationContext {
  const folder: DesignFolder = {
    root: "/tmp",
    config: {
      schemaVersion: 1,
      toolVersion: "test",
      library: { id: "shadcn-react", version: "t", source: "binary", componentsPath: "binary" },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    },
    theme: blankTheme(),
    history: new HistoryManager(),
    customCss: "",
    screens: new Map([[screen.id, screen]]),
    boards: new Map(),
    snippets: new Map(),
    annotations: new Map(),
    notes: new Map(),
  };
  return {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    provider,
    broadcast: () => {},
  };
}

describe("findNodes", () => {
  test("by ref returns paths and summaries", async () => {
    const r = unwrap(await findNodes(ctxOf(), { screenId: "home", ref: "Icon" }));
    expect(r.total).toBe(2);
    expect(r.matches.map((m) => m.path)).toEqual([[1], [2]]);
    expect(r.matches[0]?.ref).toBe("Icon");
  });

  test("prop + propValue narrows to the exact node", async () => {
    const r = unwrap(
      await findNodes(ctxOf(), {
        screenId: "home",
        ref: "Icon",
        prop: "name",
        propValue: "Github",
      }),
    );
    expect(r.total).toBe(1);
    expect(r.matches[0]?.path).toEqual([1]);
    expect(r.matches[0]?.className).toBe("size-4");
  });

  test("by $id and classContains", async () => {
    const byId = unwrap(await findNodes(ctxOf(), { screenId: "home", id: "title" }));
    expect(byId.matches[0]?.path).toEqual([0]);
    expect(byId.matches[0]?.textPreview).toBe("Hello world");

    const byClass = unwrap(await findNodes(ctxOf(), { screenId: "home", classContains: "grid" }));
    expect(byClass.total).toBe(1);
    expect(byClass.matches[0]?.path).toEqual([3]);
  });

  test("snippet instances match by snippetId", async () => {
    const r = unwrap(await findNodes(ctxOf(), { screenId: "home", snippetId: "tip-card" }));
    expect(r.total).toBe(1);
    expect(r.matches[0]).toMatchObject({ path: [3, 0], kind: "snippet", ref: "tip-card" });
  });

  test("limit caps matches but total reports all", async () => {
    const r = unwrap(await findNodes(ctxOf(), { screenId: "home", ref: "Icon", limit: 1 }));
    expect(r.matches.length).toBe(1);
    expect(r.total).toBe(2);
  });

  test("unknown screen errors", async () => {
    const r = await findNodes(ctxOf(), { screenId: "ghost", ref: "Card" });
    expect(r.ok).toBe(false);
  });
});
