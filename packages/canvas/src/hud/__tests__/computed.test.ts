import { describe, expect, test } from "bun:test";
import { computedValues } from "../computed.ts";

describe("computedValues", () => {
  test("turns resolved CSS into what each control speaks", () => {
    const out = computedValues({
      fontFamily: '"Inter", ui-sans-serif, system-ui',
      fontSize: "16px",
      fontWeight: "600",
      lineHeight: "24px",
      letterSpacing: "normal",
      textAlign: "start",
      color: "rgb(9, 9, 11)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopWidth: "2px",
      borderTopColor: "rgb(228, 228, 231)",
      paddingTop: "16px",
      paddingRight: "16px",
      paddingBottom: "16px",
      paddingLeft: "16px",
      marginTop: "0px",
      marginRight: "8px",
      marginBottom: "0px",
      marginLeft: "8px",
      columnGap: "normal",
    });
    expect(out).toMatchObject({
      font: "Inter",
      size: 16,
      weight: "semibold",
      leading: 1.5,
      tracking: "normal",
      align: "left",
      color: "#09090b",
      borderWidth: "2",
      borderColor: "#e4e4e7",
      padding: 16,
      gap: 0,
    });
    // A transparent background is "no colour", not black.
    expect(out.bg).toBeUndefined();
    // Sides that disagree have no single number to show.
    expect(out.margin).toBeUndefined();
  });

  test("reads a theme's OKLCH colours, not just rgb()", () => {
    const out = computedValues({ color: "oklch(0.5 0.01 264)", backgroundColor: "oklch(1 0 0)" });
    expect(out.color).toBe("#606369");
    expect(out.bg).toBe("#ffffff");
  });

  test("a value off the named scale shows as itself, never snapped to a rung", () => {
    const out = computedValues({
      fontSize: "16px",
      lineHeight: "normal",
      letterSpacing: "0.4px",
      borderTopWidth: "3px",
      borderTopLeftRadius: "6px",
    });
    // `line-height: normal` has no number behind it at all.
    expect(out.leading).toBeUndefined();
    expect(out.tracking).toBe("0.4px");
    expect(out.borderWidth).toBe("3px");
    expect(out.rounded).toBe("6px");
  });

  test("no report at all is an empty set, not a crash", () => {
    expect(computedValues(null)).toEqual({});
  });
});
