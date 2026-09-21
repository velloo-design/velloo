import { expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { domSuite, mount } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * How the tree pane finds out that the frame beside it is an error page.
 *
 * An iframe load reports no status to its parent and the error document runs
 * no script, so the meta tag is the whole contract — asserted here as the
 * literal string, and at the other end in the server's render-routes suite,
 * because a constant both sides import would let them rename it in step and
 * still lose each other.
 */

const { useCanvas } = await import("../store.ts");
const { readRenderError } = await import("../frame-render-error.ts");
const { ScreenTreeSection } = await import("../components/BoardsSidebar/ScreenTreeSection.tsx");

const screen: Screen = {
  id: "home",
  name: "Home",
  tree: { $ref: "Box", children: [{ $ref: "Text", props: { children: "hello" } }] },
} as Screen;

const iframeWith = (html: string) =>
  ({
    contentDocument: new DOMParser().parseFromString(html, "text/html"),
  }) as unknown as HTMLIFrameElement;

domSuite("a screen that didn't render", () => {
  test("the headline is read off the loaded document, and only off an error page", () => {
    expect(
      readRenderError(
        iframeWith(
          '<html><head><meta name="velloo-render-error" content="Too many broken components"></head><body></body></html>',
        ),
      ),
    ).toBe("Too many broken components");
    expect(readRenderError(iframeWith("<html><body><h1>A screen</h1></body></html>"))).toBeNull();
    expect(readRenderError(null)).toBeNull();
  });

  /**
   * The rows stay: the fix is usually to delete or re-point the node the tree
   * is showing, and the tree is where that is done. What they can no longer do
   * is locate anything, which is what the banner is there to say.
   */
  test("the tree pane says so, above the rows rather than instead of them", async () => {
    const server = serveFolder();
    useCanvas.setState({
      wsConnected: true,
      components: [],
      screens: { home: screen },
      renderErrors: { home: "This screen didn't render" },
      treeCollapsed: false,
      snippetFocus: null,
    } as never);

    const view = await mount(
      <ScreenTreeSection screens={[]} currentBoardId={null} currentScreenId="home" />,
    );

    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
      "This screen didn't render",
    );
    expect(view.host.querySelectorAll("[data-locate-node]").length).toBeGreaterThan(0);

    await view.unmount();
    server.restore();
  });

  test("no banner when the screen drew", async () => {
    const server = serveFolder();
    useCanvas.setState({
      wsConnected: true,
      components: [],
      screens: { home: screen },
      renderErrors: {},
      treeCollapsed: false,
      snippetFocus: null,
    } as never);

    const view = await mount(
      <ScreenTreeSection screens={[]} currentBoardId={null} currentScreenId="home" />,
    );
    expect(view.host.querySelector('[role="alert"]')).toBeNull();

    await view.unmount();
    server.restore();
  });
});
