import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrameSchemeControl } from "../FrameSchemeControl.tsx";

describe("FrameSchemeControl", () => {
  test.each([
    [undefined, "Follow canvas default for Checkout (currently dark)"],
    ["light" as const, "Pin Checkout to light mode"],
    ["dark" as const, "Pin Checkout to dark mode"],
  ])("renders one visibly selected state for %s", (scheme, selectedLabel) => {
    const html = renderToStaticMarkup(
      <FrameSchemeControl
        frameLabel="Checkout"
        scheme={scheme}
        canvasDefault="dark"
        onChange={() => {}}
      />,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain('aria-label="Color scheme for Checkout"');
    expect(html).toContain(`aria-label="${selectedLabel}" aria-pressed="true"`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  test("the three buttons clear, pin light, and pin dark", () => {
    const changes: Array<"light" | "dark" | null> = [];
    const tree = FrameSchemeControl({
      frameLabel: "Checkout",
      scheme: "dark",
      canvasDefault: "light",
      onChange: (scheme) => changes.push(scheme),
    }) as ReactElement<{
      children: Array<ReactElement<{ onClick: () => void }>>;
    }>;
    for (const button of tree.props.children) button.props.onClick();
    expect(changes).toEqual([null, "light", "dark"]);
  });
});
