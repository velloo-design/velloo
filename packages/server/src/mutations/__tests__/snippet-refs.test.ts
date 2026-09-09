import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Snippet } from "@velloo/schema";
import { designScreen, type TestContext, testContext } from "../../testing/design-folder.ts";
import { removeSnippet } from "../index.ts";
import { snippetIdsIn, snippetReferencers, unusedSnippetIds } from "../snippet-refs.ts";

const snippet = (id: string, tree: unknown): Snippet =>
  ({ id, name: id, params: [], tree }) as Snippet;

let t: TestContext;

/**
 * A reference graph with one edge of each kind that exists:
 *
 *   home ──> shell ──> nav          (screen → snippet → snippet, in `children`)
 *   stats ─> card ─┐
 *                  └> metric        (through a node-typed arg, not a child)
 *   parked                          (nothing at all)
 */
beforeEach(async () => {
  t = await testContext({
    label: "snippet-refs",
    screens: {
      home: designScreen("home", {
        tree: { $ref: "Box", children: [{ $snippet: "shell" }] },
      }),
      stats: designScreen("stats", {
        tree: {
          $ref: "Box",
          children: [{ $snippet: "card", args: { body: { $snippet: "metric" } } }],
        },
      }),
    },
    snippets: {
      shell: snippet("shell", { $ref: "Box", children: [{ $snippet: "nav" }] }),
      nav: snippet("nav", { $ref: "Box", children: [] }),
      card: snippet("card", { $ref: "Card", children: [{ $param: "body" }] }),
      metric: snippet("metric", { $ref: "Text", props: { children: "42" } }),
      parked: snippet("parked", { $ref: "Box", children: [] }),
    },
  });
});

afterEach(() => t.cleanup());

describe("snippetIdsIn", () => {
  test("finds a reference wherever it sits, not just in children", () => {
    expect([...snippetIdsIn({ $ref: "Box", children: [{ $snippet: "a" }] })]).toEqual(["a"]);
    expect([...snippetIdsIn({ $snippet: "a", args: { slot: { $snippet: "b" } } })]).toEqual([
      "a",
      "b",
    ]);
    expect([...snippetIdsIn({ $ref: "Box", props: { footer: { $snippet: "c" } } })]).toEqual(["c"]);
  });

  test("a tree with no instances names nothing", () => {
    expect(snippetIdsIn({ $ref: "Box", children: [{ $ref: "Text" }] }).size).toBe(0);
  });
});

describe("unusedSnippetIds", () => {
  test("only the snippet nothing reaches", () => {
    // `nav` is reachable through `shell` and `metric` only through an arg —
    // a direct-reference count would have called both of them unused.
    expect(unusedSnippetIds(t.folder)).toEqual(["parked"]);
  });

  test("a chain rooted in no screen is unused all the way down", async () => {
    await t.write("snippets/attic.json", snippet("attic", { $snippet: "loft" }));
    await t.write("snippets/loft.json", snippet("loft", { $ref: "Box", children: [] }));
    const folder = await t.reload();

    expect(unusedSnippetIds(folder)).toEqual(["attic", "loft", "parked"]);
  });

  test("a reference cycle doesn't hang the walk", async () => {
    // The cycle check refuses this at write time; a hand-edited folder can
    // still hold one, and reading it must terminate.
    await t.write("snippets/ping.json", snippet("ping", { $snippet: "pong" }));
    await t.write("snippets/pong.json", snippet("pong", { $snippet: "ping" }));
    const folder = await t.reload();

    expect(unusedSnippetIds(folder)).toEqual(["parked", "ping", "pong"]);
  });
});

describe("snippetReferencers", () => {
  test("splits screens from host snippets", () => {
    expect(snippetReferencers(t.folder, "nav")).toEqual({ screenIds: [], snippetIds: ["shell"] });
    expect(snippetReferencers(t.folder, "shell")).toEqual({
      screenIds: ["home"],
      snippetIds: [],
    });
  });

  test("a snippet doesn't reference itself", async () => {
    await t.write("snippets/nav.json", snippet("nav", { $ref: "Box", children: [] }));
    const folder = await t.reload();

    expect(snippetReferencers(folder, "nav").snippetIds).not.toContain("nav");
  });
});

describe("remove_snippet", () => {
  test("refuses a snippet another snippet's body embeds", async () => {
    // The guard used to walk screens only, so `nav` — reachable from a screen
    // but only *through* `shell` — deleted cleanly and broke `shell` silently.
    const result = await removeSnippet(t.ctx, { snippetId: "nav" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "SnippetInUse",
      snippetId: "nav",
      screenIds: [],
      snippetIds: ["shell"],
    });
    expect((await t.reload()).snippets.has("nav")).toBe(true);
  });

  test("refuses one passed as a node arg", async () => {
    const result = await removeSnippet(t.ctx, { snippetId: "metric" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "SnippetInUse", screenIds: ["stats"] });
  });

  test("removes one nothing references", async () => {
    expect(unwrap(await removeSnippet(t.ctx, { snippetId: "parked" })).removedId).toBe("parked");

    expect((await t.reload()).snippets.has("parked")).toBe(false);
  });
});
