import { describe, expect, test } from "bun:test";
import { pxToRadius, radiusLabel, radiusToPx } from "../components/DesignLanguage/radius.ts";

/**
 * The radius control speaks pixels; a theme stores whatever its source did.
 * A value it cannot read has to come back as "can't show", never as a number
 * the slider would then write over the real one.
 */
describe("design-language radius", () => {
  test("reads the forms a theme stores", () => {
    expect(radiusToPx("0.5rem")).toBe(8);
    expect(radiusToPx("10px")).toBe(10);
    expect(radiusToPx(6)).toBe(6);
    expect(radiusToPx("0")).toBe(0);
  });

  test("refuses what it cannot represent", () => {
    expect(radiusToPx("calc(1rem - 2px)")).toBeNull();
    expect(radiusToPx("50%")).toBeNull();
    expect(radiusToPx(undefined)).toBeNull();
  });

  test("writes rem, and round-trips", () => {
    expect(pxToRadius(8)).toBe("0.5rem");
    expect(pxToRadius(0)).toBe("0rem");
    expect(radiusToPx(pxToRadius(13))).toBe(13);
  });

  test("names a preset and nothing else", () => {
    expect(radiusLabel(8)).toBe("Soft");
    expect(radiusLabel(9)).toBe("Custom");
  });
});
