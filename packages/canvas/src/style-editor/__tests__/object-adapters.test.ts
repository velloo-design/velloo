import { describe, expect, test } from "bun:test";
import { cssToPx, parseStyle, serializeStyle } from "../style-object.ts";
import { parseSx, pxToSx, serializeSx, sxToPx } from "../sx-object.ts";

describe("sx adapter", () => {
  test("scalar keys + spacing shorthands", () => {
    const { model, extra } = parseSx({
      display: "flex",
      justifyContent: "space-between",
      gap: 2,
      p: 2,
      bgcolor: "background.paper",
      boxShadow: 3,
      cursor: "pointer",
      "&:hover": { bgcolor: "action.hover" },
    });
    expect(model.display).toBe("flex");
    expect(model.justifyContent).toBe("space-between");
    expect(model.gap).toBe(2);
    expect(model.padding).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(model.bgcolor).toBe("background.paper");
    expect(model.boxShadow).toBe(3);
    expect(extra).toEqual({ cursor: "pointer", "&:hover": { bgcolor: "action.hover" } });
  });

  test("longhand overrides shorthand regardless of order", () => {
    expect(parseSx({ pt: 1, p: 2 }).model.padding).toEqual({
      top: 1,
      right: 2,
      bottom: 2,
      left: 2,
    });
  });

  test("axis shorthands", () => {
    expect(parseSx({ px: 2, py: 1 }).model.padding).toEqual({
      top: 1,
      right: 2,
      bottom: 1,
      left: 2,
    });
  });

  test("serialize collapses sides + keeps extra", () => {
    const out = serializeSx({
      model: { ...parseSx({ p: 2 }).model, gap: 2, display: "flex" },
      extra: { cursor: "pointer" },
    });
    expect(out).toEqual({ display: "flex", gap: 2, p: 2, cursor: "pointer" });
  });

  test("round-trip semantic stability", () => {
    const input = {
      display: "flex",
      justifyContent: "space-between",
      gap: 2,
      px: 2,
      py: 1,
      bgcolor: "background.paper",
      boxShadow: 3,
      "&:hover": { bgcolor: "action.hover" },
    };
    const once = serializeSx(parseSx(input));
    expect(parseSx(once).model).toEqual(parseSx(input).model);
    expect(serializeSx(parseSx(once))).toEqual(once);
  });

  test("px <-> sx spacing (theme.spacing = 8)", () => {
    expect(sxToPx(2)).toBe(16);
    expect(sxToPx("20px")).toBe(20);
    expect(sxToPx("1rem")).toBeNull();
    expect(pxToSx(16)).toBe(2);
    expect(pxToSx(20)).toBe("20px"); // off the 8px grid
  });
});

describe("style adapter", () => {
  test("camelCase props + per-side spacing + raw remainder", () => {
    const { model, extra } = parseStyle({
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: 16,
      paddingRight: 24,
      backgroundColor: "var(--card)",
      fontSize: "0.875rem",
      transition: "all .2s",
    });
    expect(model.display).toBe("flex");
    expect(model.gap).toBe(16);
    expect(model.padding).toEqual({ top: 16, right: 24, bottom: 16, left: 16 });
    expect(model.backgroundColor).toBe("var(--card)");
    expect(model.fontSize).toBe("0.875rem");
    expect(extra).toEqual({ transition: "all .2s" });
  });

  test("multi-value padding shorthand stays raw", () => {
    const { model, extra } = parseStyle({ padding: "16px 24px" });
    expect(model.padding).toEqual({});
    expect(extra).toEqual({ padding: "16px 24px" });
  });

  test("serialize: uniform → padding, else per-side", () => {
    expect(serializeStyle(parseStyle({ padding: 16 }))).toEqual({ padding: 16 });
    const out = serializeStyle(parseStyle({ paddingTop: 8, paddingBottom: 8, paddingLeft: 4 }));
    expect(out).toEqual({ paddingTop: 8, paddingBottom: 8, paddingLeft: 4 });
  });

  test("round-trip semantic stability", () => {
    const input = {
      display: "flex",
      gap: 16,
      paddingRight: 24,
      padding: 16,
      backgroundColor: "var(--card)",
      lineHeight: 1.5,
      transition: "all .2s",
    };
    const once = serializeStyle(parseStyle(input));
    expect(parseStyle(once).model).toEqual(parseStyle(input).model);
    expect(serializeStyle(parseStyle(once))).toEqual(once);
  });

  test("cssToPx: bare number is px", () => {
    expect(cssToPx(16)).toBe(16);
    expect(cssToPx("24px")).toBe(24);
    expect(cssToPx("1rem")).toBeNull();
  });
});
