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

  test("keeps a nested key's hint out of the top-level vocabulary", () => {
    const batch = z.strictObject({
      calls: z.array(z.strictObject({ tool: z.string(), args: z.record(z.string(), z.unknown()) })),
      atomic: z.boolean().optional(),
    });
    const problem = summarizeIssues(
      issuesOf(batch, { calls: [{ tool: "add_node", args: {}, atomic: true }] }),
      ["calls", "atomic"],
    );
    expect(problem).toBe("Unknown argument `atomic` at calls.0.");
  });

  test("names the shape a near-miss branch wanted, not just its sibling's type", () => {
    const schema = z.object({ t: z.union([z.string(), z.object({ a: z.string() })]) });
    const problem = summarizeIssues(issuesOf(schema, { t: {} }), ["t"]);
    expect(problem).toContain("it takes `string`");
    expect(problem).toContain("`t.a` to be string");
  });

  test("quotes a union's literal values once", () => {
    const schema = z.object({ mode: z.union([z.literal("a"), z.literal("b")]) });
    const problem = summarizeIssues(issuesOf(schema, { mode: 3 }), ["mode"]);
    expect(problem).toContain("`a` and `b`");
    expect(problem).not.toContain("``");
  });

  test("stops after a handful of sentences and points at the issues", () => {
    const wide = z.object(
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, z.string()])),
    );
    const value = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]));
    const problem = summarizeIssues(issuesOf(wide, value), ["f0"]);
    expect(problem).toContain("`f3` expects string");
    expect(problem).not.toContain("`f4`");
    expect(problem).toContain("(+8 more");
  });

  test("is absent when there is nothing to say", () => {
    expect(summarizeIssues([], ["ids"])).toBeUndefined();
  });
});
