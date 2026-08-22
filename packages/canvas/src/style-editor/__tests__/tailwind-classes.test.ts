import { describe, expect, test } from "bun:test";
import {
  argToPx,
  parseClasses,
  pxToArg,
  serializeClasses,
  type TwModel,
} from "../tailwind-classes.ts";

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

describe("parseClasses", () => {
  test("layout utilities", () => {
    const { model } = parseClasses("flex flex-col flex-wrap items-center justify-between gap-2");
    expect(model.display).toBe("flex");
    expect(model.flexDirection).toBe("col");
    expect(model.flexWrap).toBe("wrap");
    expect(model.items).toBe("center");
    expect(model.justify).toBe("between");
    expect(model.gap).toBe("2");
  });

  test("hidden maps to display:none", () => {
    expect(parseClasses("hidden").model.display).toBe("none");
  });

  test("padding shorthand fills all sides; longhand overrides regardless of order", () => {
    const { model } = parseClasses("pt-2 p-4");
    expect(model.padding).toEqual({ top: "2", right: "4", bottom: "4", left: "4" });
  });

  test("px/py set axis pairs", () => {
    const { model } = parseClasses("px-2 py-1");
    expect(model.padding).toEqual({ top: "1", right: "2", bottom: "1", left: "2" });
  });

  test("arbitrary spacing value", () => {
    expect(parseClasses("mr-[25px]").model.margin.right).toBe("[25px]");
  });

  test("sizing", () => {
    const { model } = parseClasses("w-full h-[40px] w-1/2");
    expect(model.width).toBe("1/2"); // last wins
    expect(model.height).toBe("[40px]");
  });

  test("font- disambiguation: weight vs family", () => {
    const { model } = parseClasses("font-medium font-sans");
    expect(model.fontWeight).toBe("medium");
    expect(model.fontFamily).toBe("sans");
  });

  test("text- disambiguation: align vs size vs color", () => {
    const a = parseClasses("text-center").model;
    expect(a.textAlign).toBe("center");
    const b = parseClasses("text-sm").model;
    expect(b.fontSize).toBe("sm");
    const c = parseClasses("text-[15px]").model;
    expect(c.fontSize).toBe("[15px]");
    const d = parseClasses("text-foreground").model;
    expect(d.textColor).toBe("foreground");
    const e = parseClasses("text-[#fff]").model;
    expect(e.textColor).toBe("[#fff]");
  });

  test("typography spacing", () => {
    const { model } = parseClasses("leading-relaxed tracking-tight");
    expect(model.leading).toBe("relaxed");
    expect(model.tracking).toBe("tight");
  });

  test("appearance: bg, rounded, border", () => {
    const { model } = parseClasses("bg-card rounded-lg border border-border");
    expect(model.bg).toBe("card");
    expect(model.rounded).toBe("lg");
    expect(model.borderWidth).toBe("");
    expect(model.borderColor).toBe("border");
  });

  test("base rounded (no arg)", () => {
    expect(parseClasses("rounded").model.rounded).toBe("");
  });

  test("border width vs color", () => {
    expect(parseClasses("border-2").model.borderWidth).toBe("2");
    expect(parseClasses("border-red-500").model.borderColor).toBe("red-500");
  });

  test("variants, important, and unknown utilities are preserved in extra", () => {
    const { model, extra } = parseClasses("flex md:flex-row hover:bg-accent !p-4 shadow-sm group");
    expect(model.display).toBe("flex");
    expect(set(extra.join(" "))).toEqual(set("md:flex-row hover:bg-accent !p-4 shadow-sm group"));
  });

  test("bg non-color utilities are not treated as color", () => {
    const { model, extra } = parseClasses("bg-cover bg-center bg-card");
    expect(model.bg).toBe("card");
    expect(set(extra.join(" "))).toEqual(set("bg-cover bg-center"));
  });

  test("per-corner radius is preserved, not modeled", () => {
    const { model, extra } = parseClasses("rounded-t-lg");
    expect(model.rounded).toBeUndefined();
    expect(extra).toEqual(["rounded-t-lg"]);
  });
});

describe("serializeClasses", () => {
  test("collapses uniform spacing back to the shorthand", () => {
    const parsed = parseClasses("p-4");
    expect(serializeClasses(parsed)).toContain("p-4");
    expect(serializeClasses(parsed)).not.toContain("pt-4");
  });

  test("collapses axis pairs", () => {
    const out = serializeClasses(parseClasses("pt-1 pb-1 pl-2 pr-2"));
    expect(set(out)).toEqual(set("py-1 px-2"));
  });

  test("emits per-side when sides differ", () => {
    const out = serializeClasses(parseClasses("pt-2 pr-3 pb-4 pl-5"));
    expect(set(out)).toEqual(set("pt-2 pr-3 pb-4 pl-5"));
  });

  test("appends extra verbatim after modeled classes", () => {
    const out = serializeClasses(parseClasses("flex shadow-sm md:p-4"));
    expect(out.startsWith("flex")).toBe(true);
    expect(set(out)).toEqual(set("flex shadow-sm md:p-4"));
  });

  test("editing a model slot reflects in output", () => {
    const parsed = parseClasses("flex gap-2 bg-card");
    parsed.model.gap = "4";
    parsed.model.bg = "background";
    expect(set(serializeClasses(parsed))).toEqual(set("flex gap-4 bg-background"));
  });
});

describe("round-trip (parse → serialize preserves semantics)", () => {
  const cases = [
    "flex items-center justify-between gap-2 p-4 bg-card rounded-lg border border-border text-sm font-medium",
    "grid gap-4 w-full h-[40px] text-foreground tracking-tight leading-relaxed",
    "block px-2 py-1 mt-3 mb-3 rounded text-center text-lg font-bold border-2 border-red-500",
    "inline-flex mr-[25px] bg-[#10b981] shadow-md md:flex-row hover:underline",
  ];
  for (const input of cases) {
    test(input.slice(0, 40), () => {
      const base = parseClasses(input);
      const reparsed = parseClasses(serializeClasses(base));
      // The model + preserved extras survive a round-trip (collapse may rewrite
      // the literal classes — mt-3 mb-3 ↔ my-3 — but not the meaning).
      expect(reparsed.model).toEqual(base.model);
      expect(set(reparsed.extra.join(" "))).toEqual(set(base.extra.join(" ")));
      // ...and serialization is idempotent.
      expect(set(serializeClasses(reparsed))).toEqual(set(serializeClasses(base)));
    });
  }
});

describe("px <-> arg helpers", () => {
  test("scale steps resolve to px", () => {
    expect(argToPx("4")).toBe(16);
    expect(argToPx("2")).toBe(8);
    expect(argToPx("px")).toBe(1);
  });
  test("arbitrary px resolves", () => {
    expect(argToPx("[25px]")).toBe(25);
  });
  test("non-pixel args are null", () => {
    expect(argToPx("full")).toBeNull();
    expect(argToPx("[1rem]")).toBeNull();
    expect(argToPx(undefined)).toBeNull();
  });
  test("px snaps to scale step, else arbitrary", () => {
    expect(pxToArg(16)).toBe("4");
    expect(pxToArg(8)).toBe("2");
    expect(pxToArg(25)).toBe("[25px]");
  });
  test("round-trips on-scale", () => {
    const model: TwModel = parseClasses("gap-6").model;
    expect(argToPx(model.gap)).toBe(24);
    expect(pxToArg(24)).toBe("6");
  });
});
