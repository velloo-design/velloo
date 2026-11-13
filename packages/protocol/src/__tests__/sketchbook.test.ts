import { expect, test } from "bun:test";
import { AgentContextCardSchema } from "../agent.ts";
import { InitCreateBodySchema } from "../init.ts";
import { UpdateSketchbookBodySchema } from "../sketchbook.ts";

test("a brief longer than an image prompt can carry is refused, saying how to shorten it", () => {
  const r = UpdateSketchbookBodySchema.safeParse({
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

test("a card and an init goal saved under the old art-direction names read as the sketchbook", () => {
  expect(
    AgentContextCardSchema.parse({
      kind: "art-direction",
      ref: { step: "brief", artDirection: "k1" },
      label: "Sketchbook",
    }),
  ).toMatchObject({ kind: "sketchbook", ref: { step: "brief", sketchbook: "k1" } });
  const body = InitCreateBodySchema.parse({
    appRoot: "/app",
    storage: "repository",
    goal: "art-direction",
    agents: [],
  });
  expect(body.goal).toBe("sketchbook");
});
