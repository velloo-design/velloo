import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { searchFolder } from "../../search.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import {
  addNode,
  findNodes,
  inspect,
  moveNode,
  removeNode,
  setNodeId,
  updateProps,
} from "../index.ts";

/**
 * Text beside elements is a node like any other child: it has a path, and the
 * verbs that work on a path work on it — as far as they mean anything for a
 * node that is only its text.
 */

const jobs: Screen = {
  id: "jobs",
  name: "Jobs",
  tree: {
    $ref: "Box",
    props: { as: "ul" },
    children: [
      {
        $ref: "Box",
        props: { as: "li" },
        children: [
          { $text: "Remote " },
          { $ref: "Box", props: { as: "a", href: "/apply", children: "Apply" } },
          { $text: " today" },
        ],
      },
    ],
  },
};

let design: TestContext;
beforeEach(async () => {
  design = await testContext({ screens: { jobs } });
});
afterEach(async () => {
  await design.cleanup();
});

const row = () => {
  const tree = design.ctx.folder.screens.get("jobs")?.tree as {
    children: { children: unknown[] }[];
  };
  return tree.children[0]?.children;
};

describe("text nodes through the mutation layer", () => {
  test("update_props sets the text through `children`, the prop a component's text lives in", async () => {
    const result = await updateProps(design.ctx, {
      screenId: "jobs",
      patches: [{ path: [0, 0], propPatch: { children: "Hybrid " } }],
    });
    expect(result.ok).toBe(true);
    expect(row()).toMatchObject([{ $text: "Hybrid " }, { $ref: "Box" }, { $text: " today" }]);
    // It survives the round trip to disk as a text node.
    expect((await design.reload()).screens.get("jobs")?.tree).toMatchObject({
      children: [{ children: [{ $text: "Hybrid " }, {}, {}] }],
    });
  });

  test("it has nothing to style or give props, and says where to do that instead", async () => {
    for (const patch of [
      { style: "font-bold" },
      { propPatch: { className: "font-bold" } },
      { propPatch: { children: "x", title: "y" } },
    ]) {
      const result = await updateProps(design.ctx, {
        screenId: "jobs",
        patches: [{ path: [0, 0], ...patch }],
      });
      if (result.ok) throw new Error(`expected ${JSON.stringify(patch)} to be refused`);
      expect(JSON.stringify(result.error)).toContain("no element of its own");
      expect(JSON.stringify(result.error)).toContain("[0]");
    }
    const emptied = await updateProps(design.ctx, {
      screenId: "jobs",
      patches: [{ path: [0, 0], propPatch: { children: "" } }],
    });
    if (emptied.ok) throw new Error("expected an empty text to be refused");
    expect(JSON.stringify(emptied.error)).toContain("remove_node");
    expect(row()).toMatchObject([{ $text: "Remote " }, {}, {}]);
  });

  test("it can be removed and moved like any child", async () => {
    const moved = await moveNode(design.ctx, {
      screenId: "jobs",
      fromPath: [0, 2],
      toParent: [0],
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);
    expect(row()).toMatchObject([{ $text: " today" }, { $text: "Remote " }, { $ref: "Box" }]);

    const removed = await removeNode(design.ctx, { screenId: "jobs", path: [0, 0] });
    expect(removed.ok).toBe(true);
    expect(row()).toMatchObject([{ $text: "Remote " }, { $ref: "Box" }]);
  });

  test("it holds no children, no id and no styles", async () => {
    const child = await addNode(design.ctx, {
      screenId: "jobs",
      parentPath: [0, 0],
      componentRef: "Badge",
    });
    if (child.ok) throw new Error("expected a text node to refuse a child");
    expect(JSON.stringify(child.error)).toContain("Text beside elements");

    const named = await setNodeId(design.ctx, { screenId: "jobs", path: [0, 0], id: "lead" });
    expect(named.ok).toBe(false);

    const inspected = await inspect(design.ctx, { screenId: "jobs", path: [0, 0] });
    if (inspected.ok) throw new Error("expected inspect to point at the parent");
    expect(JSON.stringify(inspected.error)).toContain("Inspect the element it sits in, [0]");
  });

  test("find_nodes and search read its text", async () => {
    const found = await findNodes(design.ctx, { screenId: "jobs", text: "today" });
    if (!found.ok) throw new Error(JSON.stringify(found.error));
    expect(found.value.matches).toEqual([
      { path: [0, 2], kind: "text", textPreview: " today", childCount: 0 },
    ]);

    const hits = searchFolder(design.ctx.folder, "remote").text;
    expect(hits).toMatchObject([{ screenId: "jobs", path: [0, 0], prop: "children" }]);
  });
});
