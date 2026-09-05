import { describe, expect, test } from "bun:test";
import type { Node } from "@velloo/schema";
import type { ControlSpec } from "../control-set.ts";
import {
  applyStyleValue,
  blockifyForAlign,
  classNameOf,
  fontArgToPx,
  leadingToRatio,
  pxToFontArg,
  ratioToLeading,
  readControl,
  sizeChoiceOf,
  sizeFixedPx,
  uniformSide,
} from "../values.ts";

const spec = (id: string, key: string): ControlSpec =>
  ({ id, label: id, kind: "number", slot: { via: "style", key }, width: 80 }) as ControlSpec;

const node = (className: string): Node => ({ $ref: "Box", props: { as: "h1", className } });

describe("unit conversions", () => {
  test("font sizes round-trip through the type scale", () => {
    expect(fontArgToPx("base")).toBe(16);
    expect(fontArgToPx("2xl")).toBe(24);
    expect(fontArgToPx("[15px]")).toBe(15);
    expect(fontArgToPx(undefined)).toBeNull();
    expect(pxToFontArg(24)).toBe("2xl");
    expect(pxToFontArg(15)).toBe("[15px]");
  });

  test("line heights round-trip through the named utilities", () => {
    expect(leadingToRatio("tight")).toBe(1.25);
    expect(leadingToRatio("[1.4]")).toBe(1.4);
    expect(ratioToLeading(1.5)).toBe("normal");
    expect(ratioToLeading(1.4)).toBe("[1.4]");
  });

  test("a rem-based leading utility has no ratio without a font size", () => {
    expect(leadingToRatio("6")).toBeNull();
  });
});

describe("sizes speak Fill / Hug / Fixed", () => {
  test("maps keywords to outcomes", () => {
    expect(sizeChoiceOf("full")).toBe("full");
    expect(sizeChoiceOf("screen")).toBe("full");
    expect(sizeChoiceOf("fit")).toBe("fit");
    expect(sizeChoiceOf("auto")).toBe("fit");
    expect(sizeChoiceOf("[420px]")).toBe("fixed");
    expect(sizeChoiceOf("40")).toBe("fixed");
    expect(sizeChoiceOf(undefined)).toBeNull();
  });

  test("recovers the px behind a fixed size", () => {
    expect(sizeFixedPx("[420px]")).toBe(420);
    expect(sizeFixedPx("40")).toBe(160);
  });
});

describe("uniformSide", () => {
  test("collapses four equal sides", () => {
    expect(uniformSide({ top: "4", right: "4", bottom: "4", left: "4" })).toBe("4");
  });

  test("refuses to invent a value when sides differ", () => {
    expect(uniformSide({ top: "4", right: "2", bottom: "4", left: "2" })).toBeNull();
    expect(uniformSide({})).toBeNull();
  });
});

describe("readControl", () => {
  test("a value the node sets, with no theme opinion, is plain", () => {
    const v = readControl(spec("padding", "padding"), { node: node("p-4") });
    expect(v).toMatchObject({ value: 16, origin: "plain" });
  });

  test("a value matching the theme reads as inherited", () => {
    const v = readControl(spec("size", "fontSize"), {
      node: node("text-2xl"),
      themeValues: { size: 24 },
      themeSource: "Heading 1",
    });
    expect(v).toMatchObject({ value: 24, origin: "theme", source: "Heading 1" });
  });

  test("a value disagreeing with the theme reads as changed, and remembers the default", () => {
    const v = readControl(spec("size", "fontSize"), {
      node: node("text-4xl"),
      themeValues: { size: 32 },
      themeSource: "Heading 1",
    });
    expect(v).toMatchObject({
      value: 36,
      origin: "changed",
      themeValue: 32,
      source: "Heading 1",
    });
  });

  test("a silent node shows the theme's value", () => {
    const v = readControl(spec("size", "fontSize"), {
      node: node(""),
      themeValues: { size: 32 },
      themeSource: "Heading 1",
    });
    expect(v).toMatchObject({ value: 32, origin: "theme" });
  });

  test("authored says whether the node itself carries the value", () => {
    const own = readControl(spec("size", "fontSize"), {
      node: node("text-2xl"),
      themeValues: { size: 24 },
    });
    const inherited = readControl(spec("size", "fontSize"), {
      node: node(""),
      themeValues: { size: 24 },
    });
    const nothing = readControl(spec("padding", "padding"), { node: node("") });
    expect(own.authored).toBe(true);
    expect(inherited.authored).toBe(false);
    expect(nothing.authored).toBe(false);
  });

  test("snippet args read straight off the instance", () => {
    const argSpec = {
      id: "arg:customer",
      label: "Customer",
      kind: "text",
      slot: { via: "arg", name: "customer" },
      width: 120,
    } as ControlSpec;
    const v = readControl(argSpec, { node: { $snippet: "row", args: { customer: "Globex" } } });
    expect(v).toMatchObject({ value: "Globex", origin: "plain" });
  });
});

describe("applyStyleValue", () => {
  test("writes a new value and keeps everything it doesn't model", () => {
    const next = applyStyleValue("md:flex hover:bg-accent text-2xl p-4", "fontSize", 36);
    expect(next).toContain("text-4xl");
    expect(next).not.toContain("text-2xl");
    expect(next).toContain("md:flex");
    expect(next).toContain("hover:bg-accent");
    expect(next).toContain("p-4");
  });

  test("clearing a slot removes the override so the theme shows through", () => {
    const next = applyStyleValue("text-4xl font-bold", "fontSize", null);
    expect(next).not.toContain("text-4xl");
    expect(next).toContain("font-bold");
  });

  test("spacing writes all four sides and lands on the scale", () => {
    expect(applyStyleValue("", "padding", 16)).toBe("p-4");
    expect(applyStyleValue("", "padding", 25)).toBe("p-[25px]");
  });

  test("an off-scale font size becomes an arbitrary value rather than snapping", () => {
    expect(applyStyleValue("", "fontSize", 15)).toBe("text-[15px]");
  });
});

describe("classNameOf", () => {
  test("reads a component's className", () => {
    expect(classNameOf(node("p-4"))).toBe("p-4");
  });

  test("reads a snippet instance's extra classes", () => {
    expect(classNameOf({ $snippet: "row", $extraClassName: "mt-2" })).toBe("mt-2");
  });

  test("is empty for a param ref", () => {
    expect(classNameOf({ $param: "x" })).toBe("");
  });
});

describe("blockifyForAlign", () => {
  const span = (className: string): Node => ({ $ref: "Box", props: { as: "span", className } });

  test("an inline run gets the block box its alignment needs", () => {
    expect(blockifyForAlign("text-sm text-center", span("text-sm text-center"))).toBe(
      "block text-sm text-center",
    );
  });

  test("a display the node already chose is left alone", () => {
    expect(blockifyForAlign("inline-flex text-center", span("inline-flex text-center"))).toBe(
      "inline-flex text-center",
    );
  });

  test("a block tag needs nothing — text-align already bites", () => {
    const p: Node = { $ref: "Box", props: { as: "p", className: "text-center" } };
    expect(blockifyForAlign("text-center", p)).toBe("text-center");
    expect(blockifyForAlign("text-center", node("text-center"))).toBe("text-center");
  });
});
