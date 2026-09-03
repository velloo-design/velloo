import { describe, expect, test } from "bun:test";
import { Palette } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsedPaneRail, PaneCollapseButton } from "../PaneRail.tsx";
import { PaneResizer } from "../PaneResizer.tsx";

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

  test("badges an action whose pane has something waiting", () => {
    const withDot = renderToStaticMarkup(
      <CollapsedPaneRail
        side="right"
        expandLabel="Expand inspector"
        onExpand={() => {}}
        actions={[{ icon: <Palette />, label: "Node", dot: true, onClick: () => {} }]}
      />,
    );
    expect(withDot).toContain('data-rail-dot="Node"');

    const without = renderToStaticMarkup(
      <CollapsedPaneRail
        side="right"
        expandLabel="Expand inspector"
        onExpand={() => {}}
        actions={[{ icon: <Palette />, label: "Node", onClick: () => {} }]}
      />,
    );
    expect(without).not.toContain("data-rail-dot");
  });

  test("borders on the side it sits against", () => {
    const left = renderToStaticMarkup(
      <CollapsedPaneRail side="left" expandLabel="Expand sidebar" onExpand={() => {}} />,
    );
    expect(left).toContain("border-r");
    const right = renderToStaticMarkup(
      <CollapsedPaneRail side="right" expandLabel="Expand inspector" onExpand={() => {}} />,
    );
    expect(right).toContain("border-l");
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
