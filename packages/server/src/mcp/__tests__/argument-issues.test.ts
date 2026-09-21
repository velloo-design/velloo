import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { summarizeIssues } from "../argument-issues.ts";

/** The issues a real rejection carries, from parsing against a real schema. */
function issuesOf(schema: z.ZodType, value: unknown): z.core.$ZodIssue[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error("expected the value to be rejected");
  return parsed.error.issues;
}

describe("summarizeIssues", () => {
  const componentStatus = z.strictObject({
    ids: z.array(z.string().min(1)).min(1).optional(),
    screen: z.string().min(1).optional(),
  });

  test("names the accepted keys and suggests the one meant", () => {
    const problem = summarizeIssues(issuesOf(componentStatus, { components: ["Button"] }), [
      "ids",
      "screen",
      "library",
    ]);
    expect(problem).toContain("Unknown argument `components`");
    expect(problem).toContain("`ids`");
    expect(problem).toContain("accepts `ids`, `screen` and `library`");
  });

  test("reports a union failure as the shapes it takes, not one error per branch", () => {
    const tree = z.object({ tree: z.union([z.string(), z.number()]) });
    const problem = summarizeIssues(issuesOf(tree, { tree: {} }), ["tree"]);
    expect(problem).toContain("`tree`");
    expect(problem).toContain("string");
    expect(problem).not.toContain("invalid_union");
  });

  test("says what a mistyped argument expects and what arrived", () => {
    const problem = summarizeIssues(issuesOf(z.object({ name: z.string() }), { name: 3 }), [
      "name",
    ]);
    expect(problem).toBe("`name` expects string, got number.");
  });

  test("is absent when there is nothing to say", () => {
    expect(summarizeIssues([], ["ids"])).toBeUndefined();
  });
});
