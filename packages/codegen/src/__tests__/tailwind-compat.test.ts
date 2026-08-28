import { describe, expect, test } from "bun:test";
import { classNamesInJsx, v3ClassIssues } from "../tailwind-compat.ts";

function issueFor(cls: string) {
  return v3ClassIssues([cls])[0];
}

describe("v3ClassIssues", () => {
  test("renamed size ladders map to the v3 spelling", () => {
    expect(issueFor("shadow-xs")?.v3).toBe("shadow-sm");
    expect(issueFor("shadow-sm")?.v3).toBe("shadow");
    expect(issueFor("blur-xs")?.v3).toBe("blur-sm");
    expect(issueFor("backdrop-blur-sm")?.v3).toBe("backdrop-blur");
    expect(issueFor("drop-shadow-xs")?.v3).toBe("drop-shadow-sm");
    expect(issueFor("rounded-xs")?.v3).toBe("rounded-sm");
    expect(issueFor("rounded-sm")?.v3).toBe("rounded");
    expect(issueFor("rounded-tl-sm")?.v3).toBe("rounded-tl");
    expect(issueFor("outline-hidden")?.v3).toBe("outline-none");
  });

  test("variants are preserved through the rename", () => {
    expect(issueFor("hover:shadow-xs")?.v3).toBe("hover:shadow-sm");
    expect(issueFor("md:hover:rounded-sm")?.v3).toBe("md:hover:rounded");
  });

  test("ring widths shifted between majors", () => {
    expect(issueFor("ring")?.v3).toBe("ring-1");
    expect(issueFor("ring-3")?.v3).toBe("ring");
    expect(issueFor("ring-2")).toBeUndefined();
  });

  test("directional gradients rename; angle/radial forms flag without a rename", () => {
    expect(issueFor("bg-linear-to-r")?.v3).toBe("bg-gradient-to-r");
    expect(issueFor("bg-linear-45")?.v3).toBeUndefined();
    expect(issueFor("bg-linear-45")?.note).toContain("v4-only");
    expect(issueFor("bg-radial")?.note).toContain("v4-only");
  });

  test("v4-only utilities and variants are flagged", () => {
    expect(issueFor("inset-shadow-sm")?.v3).toBeUndefined();
    expect(issueFor("text-shadow-lg")?.note).toContain("v4-only");
    expect(issueFor("field-sizing-content")?.note).toContain("v4-only");
    expect(issueFor("starting:opacity-0")?.note).toContain("v4-only");
    expect(issueFor("not-first:mt-4")?.note).toContain("v4-only");
    expect(issueFor("@md:flex-row")?.note).toContain("container-quer");
  });

  test("var shorthand and important placement translate", () => {
    expect(issueFor("bg-(--brand)")?.v3).toBe("bg-[var(--brand)]");
    expect(issueFor("mt-2!")?.v3).toBe("!mt-2");
    expect(issueFor("hover:-mt-2!")?.v3).toBe("hover:!-mt-2");
  });

  test("classes spelled the same in both majors pass silently", () => {
    expect(
      v3ClassIssues([
        "flex",
        "items-center",
        "bg-primary/50",
        "shadow-md",
        "rounded-lg",
        "size-4",
        "text-balance",
        "md:grid-cols-[1fr_2fr]",
        "before:content-['*']",
      ]),
    ).toEqual([]);
  });

  test("dedupes repeated classes", () => {
    expect(v3ClassIssues(["shadow-sm", "shadow-sm"]).length).toBe(1);
  });
});

describe("classNamesInJsx", () => {
  test("collects unique classes from className attributes", () => {
    const jsx = `<div className="flex gap-2"><span className="flex text-sm" /></div>`;
    expect(classNamesInJsx(jsx).sort()).toEqual(["flex", "gap-2", "text-sm"]);
  });
});
