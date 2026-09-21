import { expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { domSuite, interact, mount, settle } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * The tree row's actions, which are the only place in the canvas that removes
 * a node. Worth driving rather than reading: the delete has to reach the
 * daemon with the right locator *and* let go of a selection that no longer
 * addresses anything — a stale selection points the inspector and the
 * selection box at whichever sibling slid into the gap.
 */

const { useCanvas } = await import("../store.ts");
const { Tree } = await import("../components/Tree.tsx");

const screen: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    children: [
      { $ref: "Box", children: [{ $ref: "Text", props: { children: "deep" } }] },
      { $ref: "Text", props: { children: "sibling" } },
    ],
  },
} as Screen;

function seed(): ReturnType<typeof serveFolder> {
  const server = serveFolder();
  useCanvas.setState({
    wsConnected: true,
    components: [],
    screens: { home: screen },
    selection: null,
    hover: null,
  } as never);
  return server;
}

const removeButtons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>("button[data-remove-node]"),
];

domSuite("tree row actions", () => {
  test("deleting posts the row's path and drops a selection inside it", async () => {
    const server = seed();
    useCanvas.setState({ selection: { screenId: "home", path: "0.0" } } as never);
    const view = await mount(<Tree screen={screen} />);

    const deleteDeepBranch = removeButtons(view.host).find(
      (b) => b.dataset.removeNode === "0",
    ) as HTMLButtonElement;
    await interact(() => deleteDeepBranch.click());
    await settle();

    expect(server.mutations).toEqual([
      { op: "remove_node", args: { screenId: "home", path: [0] } },
    ]);
    expect(useCanvas.getState().selection).toBeNull();

    await view.unmount();
    server.restore();
  });

  test("a selection outside the removed subtree survives", async () => {
    const server = seed();
    useCanvas.setState({ selection: { screenId: "home", path: "1" } } as never);
    const view = await mount(<Tree screen={screen} />);

    const deleteFirst = removeButtons(view.host).find(
      (b) => b.dataset.removeNode === "0",
    ) as HTMLButtonElement;
    await interact(() => deleteFirst.click());
    await settle();

    expect(useCanvas.getState().selection).toEqual({ screenId: "home", path: "1" });

    await view.unmount();
    server.restore();
  });

  /**
   * `remove_node` reads a root locator as "empty the screen", which is not
   * what a row's delete button promises — so the root doesn't offer one.
   */
  test("the root row has no delete", async () => {
    const server = seed();
    const view = await mount(<Tree screen={screen} />);
    expect(removeButtons(view.host).map((b) => b.dataset.removeNode)).toEqual(["0", "0.0", "1"]);
    await view.unmount();
    server.restore();
  });

  test("collapsing a branch takes its rows out of the tree once the slide ends", async () => {
    const server = seed();
    const view = await mount(<Tree screen={screen} />);
    const rows = () => view.host.querySelectorAll("[data-locate-node]").length;
    expect(rows()).toBe(4);

    const collapseRoot = view.host.querySelector(
      'button[aria-label="Collapse"]',
    ) as HTMLButtonElement;
    await interact(() => collapseRoot.click());
    // Still mounted mid-animation — there has to be something to animate away.
    expect(rows()).toBe(4);
    await settle(250);
    expect(rows()).toBe(1);

    await view.unmount();
    server.restore();
  });
});
