import { expect, test } from "bun:test";
import { UpdateArtDirectionBodySchema } from "../art-direction.ts";

test("a brief longer than an image prompt can carry is refused, saying how to shorten it", () => {
  const r = UpdateArtDirectionBodySchema.safeParse({
    brief: {
      origin: "existing",
      product: "Trailhead",
      page: "the landing page",
      content: "x".repeat(2801),
    },
  });
  expect(r.success).toBe(false);
  expect(r.error?.issues[0]?.message).toContain("at most 2800 characters");
  expect(r.error?.issues[0]?.message).toContain("keep every heading, button and label");
});
