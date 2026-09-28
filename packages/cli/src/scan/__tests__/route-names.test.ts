import { describe, expect, test } from "bun:test";
import { NodeIdSchema } from "@velloo/schema";
import { idFromRoutePath } from "../route-names.ts";

describe("idFromRoutePath", () => {
  test("a deep route in a big app still makes a valid screen id, distinct from its neighbour", () => {
    const head = "/horilla-api/api-urls/recruitment/recruitment-stage-note-update";
    const a = idFromRoutePath(`${head}/<int:pk>/candidate/attachments`);
    const b = idFromRoutePath(`${head}/<int:pk>/candidate/interviews`);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(NodeIdSchema.safeParse(a).success).toBe(true);
    expect(a.startsWith("horilla-api-api-urls-recruitment")).toBe(true);
    expect(a).not.toBe(b);
  });

  test("an ordinary route keeps its readable id", () => {
    expect(idFromRoutePath("/videos/category/<cat_name>")).toBe("videos-category-cat-name");
  });
});
