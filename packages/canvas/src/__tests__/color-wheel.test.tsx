import { expect, test } from "bun:test";
import { $, domSuite, mount } from "./dom.ts";

const { ColorWheel } = await import("../components/color-picker.tsx");

/**
 * The disc has to show what a click on it would give. At full brightness that
 * is the plain hue wheel; turned down, every point on it is that much darker,
 * and a wheel that stayed bright would be offering colours it cannot produce.
 */
domSuite("colour wheel", () => {
  test("the disc dims with the brightness it will pick at", async () => {
    for (const [v, veil] of [
      [1, "rgba(0,0,0,0)"],
      [0.25, "rgba(0,0,0,0.75)"],
    ] as const) {
      const view = await mount(<ColorWheel value={{ h: 200, s: 0.5, v }} onChange={() => {}} />);
      try {
        const disc = $("[role='application']") as HTMLElement;
        expect(disc.style.backgroundImage.replace(/\s+/g, "")).toContain(
          `linear-gradient(${veil},${veil})`,
        );
      } finally {
        await view.unmount();
      }
    }
  });
});
