import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { ComponentNode, Screen } from "@velloo/schema";
import { testContext } from "../../testing/design-folder.ts";
import {
  addNode,
  type MutationContext,
  moveNode,
  removeNode,
  setNodeId,
  updateProps,
} from "../index.ts";

/**
 * The tree mutations — the operations an agent spends most of its calls on,
 * and the layer CLAUDE.md's invariant #6 exists to protect. `mutations/` is
 * otherwise well covered; this family was the hole: 22 mutation suites and not
 * one about moving, removing or naming a node.
 *
 * `move_node` gets the most attention because it is the one with real
 * arithmetic — index shifts after the detach, and a destination path that has
 * to be rewritten when the detach moves it. Its `newPath` is the part worth
 * guarding hardest: agents chain the next call onto it, so a wrong value
 * corrupts the *following* mutation, far from the cause.
 */

let folder: Awaited<ReturnType<typeof testContext>>;
let ctx: MutationContext;

/**
 *  root Card
 *   ├─ 0 Box "a"      └─ 0 Text "a0"
 *   ├─ 1 Box "b"      ├─ 0 Text "b0"  └─ 1 Text "b1"
 *   └─ 2 Box "c"
 */
const tree = (): ComponentNode => ({
  $ref: "Card",
  children: [
    { $ref: "Box", $id: "a", children: [{ $ref: "Text", $id: "a0", props: { children: "a0" } }] },
    {
      $ref: "Box",
      $id: "b",
      children: [
        { $ref: "Text", $id: "b0", props: { children: "b0" } },
        { $ref: "Text", $id: "b1", props: { children: "b1" } },
      ],
    },
    { $ref: "Box", $id: "c" },
    { $snippet: "card", $id: "inst", props: { label: "hi" } },
  ],
});

beforeEach(async () => {
  folder = await testContext({
    label: "tree-nodes",
    screens: { home: { id: "home", name: "Home", tree: tree() } as Screen },
    snippets: {
      card: {
        id: "card",
        name: "Card",
        params: [{ name: "label", type: "string" }],
        tree: {
          $ref: "Card",
          children: [{ $ref: "Text", children: [{ $param: "label" }] }],
        },
      } as never,
    },
  });
  ctx = folder.ctx;
});

afterEach(() => folder.cleanup());

/** The live tree, as the next mutation would see it. */
const live = () => ctx.folder.screens.get("home")?.tree as ComponentNode;
/** `$id`s of a node's children, for readable structural assertions. */
const kids = (node: ComponentNode | undefined) =>
  (node?.children ?? []).map((c) => ("$id" in c ? c.$id : "?"));
const at = (...path: number[]): ComponentNode => {
  let node: ComponentNode = live();
  for (const i of path) node = (node.children?.[i] ?? {}) as ComponentNode;
  return node;
};
const persisted = () =>
  Bun.file(join(folder.root, "screens/home.json")).json() as Promise<{ tree: ComponentNode }>;

describe("move_node — reordering among siblings", () => {
  test("moving right accounts for the gap the node leaves behind", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [1, 0], toParent: [1], toIndex: 2 }),
    );
    expect(kids(at(1))).toEqual(["b1", "b0"]);
    expect(newPath).toEqual([1, 1]);
  });

  test("moving left uses the index as given", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [1, 1], toParent: [1], toIndex: 0 }),
    );
    expect(kids(at(1))).toEqual(["b1", "b0"]);
    expect(newPath).toEqual([1, 0]);
  });

  test("no index means append", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [2] }),
    );
    expect(kids(at(1))).toEqual(["a"]);
    expect(newPath).toEqual([1, 0]);
  });

  test("an index past the end lands at the end rather than erroring", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1], toIndex: 99 }),
    );
    expect(kids(at(0))).toEqual(["b0", "b1", "a"]);
    expect(newPath).toEqual([0, 2]);
  });

  test("a negative index lands at the front", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1], toIndex: -5 }),
    );
    expect(kids(at(0))).toEqual(["a", "b0", "b1"]);
    expect(newPath).toEqual([0, 0]);
  });
});

describe("move_node — reparenting", () => {
  test("into a later sibling, whose own path the detach shifts", async () => {
    // Detaching `a` from the root slides `b` from index 1 to 0, so the
    // destination has to be rewritten or the move lands in the wrong parent.
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1] }),
    );
    expect(kids(live())).toEqual(["b", "c", "inst"]);
    expect(kids(at(0))).toEqual(["b0", "b1", "a"]);
    expect(newPath).toEqual([0, 2]);
  });

  test("into an earlier sibling, whose path the detach leaves alone", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [2], toParent: [0] }),
    );
    expect(kids(live())).toEqual(["a", "b", "inst"]);
    expect(kids(at(0))).toEqual(["a0", "c"]);
    expect(newPath).toEqual([0, 1]);
  });

  test("out of a parent it empties, which drops the empty children key", async () => {
    unwrap(await moveNode(ctx, { screenId: "home", fromPath: [0, 0], toParent: [2] }));
    expect(at(0).children).toBeUndefined();
    expect(kids(at(2))).toEqual(["a0"]);
    expect((await persisted()).tree.children?.[0]).not.toHaveProperty("children");
  });

  test("into a leaf, which grows a children list", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [2] }),
    );
    expect(kids(at(1))).toEqual(["a"]);
    expect(newPath).toEqual([1, 0]);
  });

  test("into a grandchild of a later sibling, adjusted at the right segment", async () => {
    // The rewrite has to fix the segment that indexes the *from-parent's*
    // children — [1, 0] becomes [0, 0] — not the last segment or the first.
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1, 0] }),
    );
    expect(kids(live())).toEqual(["b", "c", "inst"]);
    expect(kids(at(0, 0))).toEqual(["a"]);
    expect(newPath).toEqual([0, 0, 0]);
  });

  test("into a later sibling that shares its parent", async () => {
    // Detaching b0 slides b1 from index 1 to 0 within the same parent, so the
    // destination shifts even though the move never leaves that parent.
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [1, 0], toParent: [1, 1] }),
    );
    expect(kids(at(1))).toEqual(["b1"]);
    expect(kids(at(1, 0))).toEqual(["b0"]);
    expect(newPath).toEqual([1, 0, 0]);
  });

  test("a snippet instance moves as one unit", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: "@inst", toParent: [1] }),
    );
    expect(kids(live())).toEqual(["a", "b", "c"]);
    expect(kids(at(1))).toEqual(["b0", "b1", "inst"]);
    expect(newPath).toEqual([1, 2]);
  });

  test("addressed by @id on both ends", async () => {
    unwrap(await moveNode(ctx, { screenId: "home", fromPath: "@b0", toParent: "@c" }));
    expect(kids(at(1))).toEqual(["b1"]);
    expect(kids(at(2))).toEqual(["b0"]);
  });
});

describe("move_node — refusals", () => {
  const failure = async (args: Parameters<typeof moveNode>[1]) => {
    const result = await moveNode(ctx, args);
    if (result.ok) throw new Error("expected the move to be refused");
    return result.error as { kind: string; reason?: string };
  };

  test("the screen root cannot be moved", async () => {
    const error = await failure({ screenId: "home", fromPath: [], toParent: [1] });
    expect(error.kind).toBe("InvalidMove");
    expect(error.reason).toContain("screen root");
  });

  test("a node cannot be moved into itself", async () => {
    const error = await failure({ screenId: "home", fromPath: [1], toParent: [1] });
    expect(error.kind).toBe("InvalidMove");
    expect(error.reason).toContain("itself or its descendant");
  });

  test("a node cannot be moved into its own descendant", async () => {
    const error = await failure({ screenId: "home", fromPath: [1], toParent: [1, 0] });
    expect(error.kind).toBe("InvalidMove");
    expect(error.reason).toContain("itself or its descendant");
  });

  test("a snippet instance is opaque — nothing can be moved inside one", async () => {
    await failure({ screenId: "home", fromPath: [0], toParent: [3] });
    expect(kids(live())).toEqual(["a", "b", "c", "inst"]);
  });

  test("a path that addresses nothing is refused", async () => {
    await failure({ screenId: "home", fromPath: [9], toParent: [1] });
    await failure({ screenId: "home", fromPath: [0], toParent: [9] });
  });

  test("an unknown screen is refused", async () => {
    await failure({ screenId: "nope", fromPath: [0], toParent: [1] });
  });

  test("a refused move leaves the tree exactly as it was", async () => {
    const before = JSON.stringify(live());
    await failure({ screenId: "home", fromPath: [1], toParent: [1, 0] });
    expect(JSON.stringify(live())).toBe(before);
  });
});

describe("move_node — what the caller does next", () => {
  test("newPath addresses the moved node, not whatever slid into its place", async () => {
    const { newPath } = unwrap(
      await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1] }),
    );
    // The contract an agent chains on: the very next call, aimed at newPath,
    // must land on the node that was just moved.
    unwrap(
      await updateProps(ctx, {
        screenId: "home",
        patches: [{ path: newPath, propPatch: { id: "landed" } }],
      }),
    );
    const moved = at(...newPath);
    expect(moved.$id).toBe("a");
    expect(moved.props?.id).toBe("landed");
  });

  test("persists and announces the change", async () => {
    unwrap(await moveNode(ctx, { screenId: "home", fromPath: [0], toParent: [1] }));
    expect((await persisted()).tree.children?.map((c) => ("$id" in c ? c.$id : "?"))).toEqual([
      "b",
      "c",
      "inst",
    ]);
    expect(folder.events.some((e) => "type" in e && e.type === "screen-changed")).toBe(true);
  });
});

describe("remove_node", () => {
  test("removes a child and names what went", async () => {
    const { removedRef } = unwrap(await removeNode(ctx, { screenId: "home", path: [1, 0] }));
    expect(removedRef).toBe("Text");
    expect(kids(at(1))).toEqual(["b1"]);
  });

  test("drops the children key when the last child goes", async () => {
    unwrap(await removeNode(ctx, { screenId: "home", path: [0, 0] }));
    expect(at(0).children).toBeUndefined();
    expect((await persisted()).tree.children?.[0]).not.toHaveProperty("children");
  });

  test("a root locator clears the screen instead of removing the root", async () => {
    const { removedRef } = unwrap(await removeNode(ctx, { screenId: "home", path: [] }));
    expect(removedRef).toContain("cleared 4 child nodes");
    expect(live().$ref).toBe("Card");
    expect(live().children).toBeUndefined();
  });

  test("a path that addresses nothing is refused, and changes nothing", async () => {
    const before = JSON.stringify(live());
    const result = await removeNode(ctx, { screenId: "home", path: [1, 9] });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(live())).toBe(before);
  });

  test("names a removed snippet instance by its snippet", async () => {
    const { removedRef } = unwrap(await removeNode(ctx, { screenId: "home", path: "@inst" }));
    expect(removedRef).toBe("@card");
  });

  test("addressed by @id", async () => {
    unwrap(await removeNode(ctx, { screenId: "home", path: "@b1" }));
    expect(kids(at(1))).toEqual(["b0"]);
  });
});

describe("set_node_id", () => {
  test("names a node, and clears the name with null", async () => {
    const set = unwrap(await setNodeId(ctx, { screenId: "home", path: [2], id: "footer" }));
    expect(set).toEqual({ path: [2], id: "footer" });
    expect(at(2).$id).toBe("footer");

    unwrap(await setNodeId(ctx, { screenId: "home", path: [2], id: null }));
    expect(at(2).$id).toBeUndefined();
    expect((await persisted()).tree.children?.[2]).not.toHaveProperty("$id");
  });

  test("rejects an id the locator syntax could never address", async () => {
    for (const id of ["", "1leading-digit", "has space", "@at", "dot.ted"]) {
      const result = await setNodeId(ctx, { screenId: "home", path: [2], id });
      expect(result.ok).toBe(false);
    }
    expect(at(2).$id).toBe("c");
  });

  test("renaming by the old @id lands on the same node", async () => {
    unwrap(await setNodeId(ctx, { screenId: "home", path: "@c", id: "renamed" }));
    expect(at(2).$id).toBe("renamed");
  });

  test("a param ref is anonymous and refuses an id", async () => {
    const result = await setNodeId(ctx, {
      screenId: "snippet:card",
      path: [0, 0],
      id: "the-param",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { kind: string; reason: string }).reason).toContain("anonymous");
    }
  });
});

describe("add_node", () => {
  test("inserts at an index and returns the path it landed on", async () => {
    const { path } = unwrap(
      await addNode(ctx, {
        screenId: "home",
        parentPath: [1],
        componentRef: "Text",
        id: "inserted",
        index: 1,
      }),
    );
    expect(path).toEqual([1, 1]);
    expect(kids(at(1))).toEqual(["b0", "inserted", "b1"]);
  });

  test("no index appends", async () => {
    const { path } = unwrap(
      await addNode(ctx, { screenId: "home", parentPath: [1], componentRef: "Text", id: "last" }),
    );
    expect(path).toEqual([1, 2]);
  });

  test("grows a children list on a leaf parent", async () => {
    unwrap(
      await addNode(ctx, { screenId: "home", parentPath: [2], componentRef: "Text", id: "first" }),
    );
    expect(kids(at(2))).toEqual(["first"]);
  });

  test("an index outside the parent's range is refused", async () => {
    for (const index of [-1, 99]) {
      const result = await addNode(ctx, {
        screenId: "home",
        parentPath: [1],
        componentRef: "Text",
        index,
      });
      expect(result.ok).toBe(false);
    }
    expect(kids(at(1))).toEqual(["b0", "b1"]);
  });

  test("a component the library doesn't have is refused", async () => {
    const result = await addNode(ctx, {
      screenId: "home",
      parentPath: [1],
      componentRef: "NoSuchComponent",
    });
    expect(result.ok).toBe(false);
  });
});
