import { describe, expect, test } from "bun:test";
import { Palette } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsedPaneRail, PaneCollapseButton } from "../PaneRail.tsx";
import { PaneResizer } from "../PaneResizer.tsx";
import { PaneShell } from "../PaneShell.tsx";

/**
 * The rail is the only way back into a collapsed pane, so its expand control
 * has to be there and be labelled — server-rendering asserts both, and covers
 * the action list the pane's tabs are projected onto.
 */
describe("CollapsedPaneRail", () => {
  test("renders a labelled expand control and the pane's tabs", () => {
    const html = renderToStaticMarkup(
      <CollapsedPaneRail
        side="right"
        expandLabel="Expand inspector"
        hotkey="]"
        onExpand={() => {}}
        actions={[
          { icon: <Palette />, label: "Theme", active: true, onClick: () => {} },
          { icon: <Palette />, label: "Node", onClick: () => {} },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Expand inspector"');
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain('aria-label="Node"');
    // The active tab reads as selected on the rail, not just in the pane.
    expect(html).toContain("bg-accent");
  });

  test("the hotkey rides in the tooltip, not the accessible name", () => {
    const html = renderToStaticMarkup(
      <CollapsedPaneRail side="left" expandLabel="Expand sidebar" hotkey="[" onExpand={() => {}} />,
    );
    expect(html).toContain('title="Expand sidebar — ["');
    expect(html).toContain('aria-label="Expand sidebar"');
  });

  test("a badged action says in its tooltip what the badge means", () => {
    const withDot = renderToStaticMarkup(
      <CollapsedPaneRail
        side="left"
        expandLabel="Expand sidebar"
        onExpand={() => {}}
        actions={[
          {
            icon: <Palette />,
            label: "Boards",
            dot: { title: "an agent edited another board" },
            onClick: () => {},
          },
        ]}
      />,
    );
    expect(withDot).toContain('data-rail-dot="Boards"');
    expect(withDot).toContain('title="Boards — an agent edited another board"');

    const without = renderToStaticMarkup(
      <CollapsedPaneRail
        side="left"
        expandLabel="Expand sidebar"
        onExpand={() => {}}
        actions={[{ icon: <Palette />, label: "Boards", onClick: () => {} }]}
      />,
    );
    expect(without).not.toContain("data-rail-dot");
    expect(without).toContain('title="Boards"');
  });
});

describe("PaneShell", () => {
  const shell = (props: Partial<React.ComponentProps<typeof PaneShell>> = {}) =>
    renderToStaticMarkup(
      <PaneShell
        side="left"
        collapsed={false}
        width={320}
        onResize={() => {}}
        rail={<div data-testid="rail" />}
        {...props}
      >
        <div data-testid="content" />
      </PaneShell>,
    );

  test("borders on the side it sits against", () => {
    expect(shell({ side: "left" })).toContain("border-r");
    expect(shell({ side: "right" })).toContain("border-l");
  });

  test("collapses to the rail width and swaps the content for the rail", () => {
    const collapsed = shell({ collapsed: true });
    expect(collapsed).toContain("width:36px");
    expect(collapsed).toContain('data-testid="rail"');
    expect(collapsed).not.toContain('data-testid="content"');
    // Nothing to resize while collapsed — the rail's expand button is the way back.
    expect(collapsed).not.toContain('role="separator"');
  });

  test("expands to the pane's own width, with content and a resize handle", () => {
    const expanded = shell({ width: 420 });
    expect(expanded).toContain("width:420px");
    expect(expanded).toContain('data-testid="content"');
    expect(expanded).toContain('role="separator"');
  });

  test("dims the content without touching the rail or the handle", () => {
    const disabled = shell({ contentDisabled: true });
    expect(disabled).toContain("pointer-events-none");
    expect(disabled).toContain('aria-disabled="true"');
    // The handle opts back in: resizing is chrome, not a design edit.
    expect(disabled).toContain("pointer-events-auto");
  });
});

describe("PaneCollapseButton", () => {
  test("names the action and shows the hotkey on hover", () => {
    const html = renderToStaticMarkup(
      <PaneCollapseButton side="left" label="Collapse sidebar" hotkey="[" onCollapse={() => {}} />,
    );
    expect(html).toContain('aria-label="Collapse sidebar"');
    expect(html).toContain('title="Collapse sidebar — ["');
  });
});

describe("PaneResizer", () => {
  test("exposes the drag as a separator with its range", () => {
    const html = renderToStaticMarkup(
      <PaneResizer side="left" width={320} onCommit={() => {}} paneRef={{ current: null }} />,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize sidebar"');
    expect(html).toContain('aria-valuenow="320"');
    expect(html).toContain('aria-valuemin="240"');
    expect(html).toContain('aria-valuemax="560"');
    // Keyboard-reachable, so the panes resize without a pointer.
    expect(html).toContain('tabindex="0"');
  });

  test("hangs off the pane's inner edge", () => {
    const left = renderToStaticMarkup(
      <PaneResizer side="left" width={320} onCommit={() => {}} paneRef={{ current: null }} />,
    );
    expect(left).toContain("right-0");
    const right = renderToStaticMarkup(
      <PaneResizer side="right" width={320} onCommit={() => {}} paneRef={{ current: null }} />,
    );
    expect(right).toContain("left-0");
  });
});
