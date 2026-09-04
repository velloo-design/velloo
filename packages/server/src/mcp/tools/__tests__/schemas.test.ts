import { describe, expect, test } from "bun:test";
import { InnerPathSchema, NodeIdInputSchema, PathSchema, ViewportSchema } from "../schemas.ts";

describe("PathSchema", () => {
  test("accepts a path array, an @id, and the JSON string form of a path array", () => {
    for (const ok of [[], [0, 2, 1], "@hero-cta", "[0,2]", "[]", "[ 0, 1 ]"]) {
      expect(PathSchema.safeParse(ok).success).toBe(true);
    }
  });

  test("rejects a bare string that is neither an @id nor a bracketed array", () => {
    // The pre-unification loose `z.string()` let these through, then they
    // missed at resolve time — the shared schema rejects them up front.
    for (const bad of ["hero-cta", "@bad id", "{0}", "0.2"]) {
      expect(PathSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("NodeIdInputSchema", () => {
  test("requires a leading letter, no @ prefix", () => {
    expect(NodeIdInputSchema.safeParse("hero-cta").success).toBe(true);
    expect(NodeIdInputSchema.safeParse("2hero").success).toBe(false);
    expect(NodeIdInputSchema.safeParse("@hero").success).toBe(false);
  });
});

describe("InnerPathSchema", () => {
  test('accepts the body root (""), a dotted index path, and an @id', () => {
    for (const ok of ["", "0.2", "@nav-dashboard"]) {
      expect(InnerPathSchema.safeParse(ok).success).toBe(true);
    }
  });
});

describe("ViewportSchema", () => {
  test("requires positive integer w/h", () => {
    expect(ViewportSchema.safeParse({ w: 1440, h: 900 }).success).toBe(true);
    expect(ViewportSchema.safeParse({ w: 0, h: 900 }).success).toBe(false);
    expect(ViewportSchema.safeParse({ w: 1440 }).success).toBe(false);
  });
});

describe("ViewportSchema", () => {
  test("is the single render-size form — no flat w/h to reconcile", () => {
    expect(ViewportSchema.safeParse({ w: 1440, h: 900 }).success).toBe(true);
    expect(ViewportSchema.safeParse({ w: 1440 }).success).toBe(false);
  });
});
