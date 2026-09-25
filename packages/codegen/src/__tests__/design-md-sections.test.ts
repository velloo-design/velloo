import { describe, expect, test } from "bun:test";
import {
  DESIGN_MD_SECTIONS,
  designMdSection,
  markdownSections,
} from "../emit-theme/design-md-sections.ts";

/**
 * One home for DESIGN.md's section vocabulary, because both directions need
 * it: the emitter writes these headings, and the reviewer path reads stored
 * guidance back out of them. A heading that stops matching does not error —
 * it returns nothing — so the drift would be silent.
 */

describe("DESIGN_MD_SECTIONS", () => {
  test("is the spec's eight sections, in the spec's order", () => {
    expect([...DESIGN_MD_SECTIONS]).toEqual([
      "Overview",
      "Colors",
      "Typography",
      "Layout",
      "Elevation & Depth",
      "Shapes",
      "Components",
      "Do's and Don'ts",
    ]);
  });
});

describe("designMdSection", () => {
  test("finds a section by its canonical heading", () => {
    expect(designMdSection({ Overview: "calm" }, "Overview")).toBe("calm");
  });

  test("finds the aliases the spec allows", () => {
    // Every example Google ships opens with `## Brand & Style`.
    expect(designMdSection({ "Brand & Style": "calm" }, "Overview")).toBe("calm");
    expect(designMdSection({ "Layout & Spacing": "8pt" }, "Layout")).toBe("8pt");
    expect(designMdSection({ Elevation: "soft" }, "Elevation & Depth")).toBe("soft");
  });

  test("matches across apostrophe, ampersand and case differences", () => {
    expect(designMdSection({ "Do’s and Don’ts": "r" }, "Do's and Don'ts")).toBe("r");
    expect(designMdSection({ "Dos and Donts": "r" }, "Do's and Don'ts")).toBe("r");
    expect(designMdSection({ "DO'S AND DON'TS": "r" }, "Do's and Don'ts")).toBe("r");
    expect(designMdSection({ "Elevation and Depth": "soft" }, "Elevation & Depth")).toBe("soft");
  });

  test("an empty or whitespace-only body counts as absent", () => {
    expect(designMdSection({ Overview: "   " }, "Overview")).toBeUndefined();
    expect(designMdSection({ Overview: "" }, "Overview")).toBeUndefined();
  });

  test("a canonical heading wins over an alias in the same document", () => {
    expect(designMdSection({ "Brand & Style": "alias", Overview: "canonical" }, "Overview")).toBe(
      "canonical",
    );
  });

  test("unknown sections and undefined input return nothing", () => {
    expect(designMdSection({ "Known Gaps": "x" }, "Overview")).toBeUndefined();
    expect(designMdSection(undefined, "Overview")).toBeUndefined();
  });
});

describe("markdownSections", () => {
  test("splits on `##` headings and keeps the preamble under the empty key", () => {
    expect(
      markdownSections("# Acme\n\nIntro.\n\n## Overview\n\nCalm.\n\n## Colors\n\nOne.\n"),
    ).toEqual({
      "": "# Acme\n\nIntro.",
      Overview: "Calm.",
      Colors: "One.",
    });
  });

  test("a duplicate heading keeps the first body", () => {
    expect(markdownSections("## Colors\n\nFirst.\n\n## Colors\n\nSecond.\n").Colors).toBe("First.");
  });

  test("deeper headings stay inside their section", () => {
    expect(markdownSections("## Colors\n\n### Primary\n\nIndigo.\n").Colors).toBe(
      "### Primary\n\nIndigo.",
    );
  });
});
