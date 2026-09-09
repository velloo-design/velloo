import { expect, mock, test } from "bun:test";
import type { FrameScheme } from "@velloo/schema";
import { domSuite, mount } from "../../../__tests__/dom.ts";

/**
 * The header counter-scales against the board zoom, so its layout box is
 * `frame width × zoom` — a 390px mobile frame gets 39px of chrome at 10%. The
 * fixed parts (grip, two size inputs, badges, menu) don't shrink, so below a
 * couple of hundred pixels the row used to spill sideways across whatever
 * frame sat to the right of it: at low zoom a board read as a row of giant
 * "390 × 2000" numbers with the frames buried underneath.
 */

mock.module("../../../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { FrameHeader } = await import("../FrameHeader.tsx");

const noop = () => {};

function header(chromeWidth: number, scheme?: FrameScheme) {
  return (
    <FrameHeader
      label="Baseline — today"
      w={390}
      h={2000}
      sharedCount={3}
      library="mui"
      presets={[]}
      canvasDefault="light"
      scheme={scheme}
      chromeWidth={chromeWidth}
      onPointerDownGrip={noop}
      onRemove={noop}
      onExport={noop}
      onResize={noop}
      onPreview={noop}
      onAddSibling={noop}
      onSchemeChange={noop}
      moveTargets={[]}
      onMoveToBoard={noop}
      onMoveToNewBoard={noop}
    />
  );
}

const sizeInput = (host: HTMLElement) => host.querySelector('input[aria-label="frame width"]');
const badges = (host: HTMLElement) =>
  host.querySelectorAll('[title*="renders against library"], [title*="share this screen"]');
const schemeBadge = (host: HTMLElement) => host.querySelector('[title^="Pinned to"]');

domSuite("the frame header", () => {
  test("shows the size inputs and badges when the frame is wide on screen", async () => {
    const { host, unmount } = await mount(header(390));

    expect(sizeInput(host)).not.toBeNull();
    expect(badges(host).length).toBe(2);
    await unmount();
  });

  test("sheds everything but the name and the actions menu when zoomed out", async () => {
    const { host, unmount } = await mount(header(64));

    expect(sizeInput(host)).toBeNull();
    expect(badges(host).length).toBe(0);
    expect(host.textContent).toContain("Baseline — today");
    expect(host.querySelector('button[title="Frame actions"]')).not.toBeNull();
    await unmount();
  });

  /**
   * A pinned frame is otherwise indistinguishable from one following the
   * canvas — you'd have to open its menu, or notice it didn't move when the
   * canvas default flipped.
   */
  test("badges the pinned colour scheme, and only when one is pinned", async () => {
    const view = await mount(header(390));
    expect(schemeBadge(view.host)).toBeNull();

    await view.render(header(390, "dark"));
    expect(schemeBadge(view.host)?.getAttribute("aria-label")).toBe("pinned to dark");

    await view.render(header(390, "light"));
    expect(schemeBadge(view.host)?.getAttribute("aria-label")).toBe("pinned to light");
    await view.unmount();
  });

  test("drops the scheme badge with the rest when zoomed out", async () => {
    const { host, unmount } = await mount(header(64, "dark"));

    expect(schemeBadge(host)).toBeNull();
    expect(host.textContent).toContain("Baseline — today");
    await unmount();
  });

  /**
   * The label truncates rather than pushing the menu out of the frame, so the
   * row can't grow past the width it was given whatever the screen is called.
   */
  test("truncates the name instead of widening the row", async () => {
    const { host, unmount } = await mount(header(64));

    const label = host.querySelector("span.font-medium") as HTMLElement;
    expect(label.className).toContain("truncate");
    expect(label.getAttribute("title")).toBe("Baseline — today");
    expect((host.firstElementChild as HTMLElement).className).toContain("overflow-hidden");
    await unmount();
  });
});
