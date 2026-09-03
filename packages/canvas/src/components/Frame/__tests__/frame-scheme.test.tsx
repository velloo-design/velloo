import { describe, expect, test } from "bun:test";
import { frameSchemeOptions } from "../frame-scheme.ts";

describe("frameSchemeOptions", () => {
  test.each([
    [undefined, "Follow canvas default for Checkout (currently dark)"],
    ["light" as const, "Pin Checkout to light mode"],
    ["dark" as const, "Pin Checkout to dark mode"],
  ])("marks exactly one option current for %s", (scheme, currentLabel) => {
    const options = frameSchemeOptions("Checkout", "dark", scheme);
    const current = options.filter((o) => o.current);
    expect(current).toHaveLength(1);
    expect(current[0]?.ariaLabel).toBe(currentLabel);
  });

  test("offers clear, pin light, and pin dark in that order", () => {
    const options = frameSchemeOptions("Checkout", "light", "dark");
    expect(options.map((o) => o.value)).toEqual([null, "light", "dark"]);
  });

  test("names the canvas default the follow option would fall back to", () => {
    expect(frameSchemeOptions("Checkout", "light")[0]?.label).toBe("Follow canvas (light)");
    expect(frameSchemeOptions("Checkout", "dark")[0]?.label).toBe("Follow canvas (dark)");
  });
});
