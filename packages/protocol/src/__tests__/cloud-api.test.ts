import { describe, expect, test } from "bun:test";
import { LinkResponseSchema, PublishedDesignSchema, TeamsResponseSchema } from "../cloud-api.ts";

describe("cloud permission fields", () => {
  test("teams carry canPublish/canManage and any role, and older clouds still parse", () => {
    const parsed = TeamsResponseSchema.parse({
      teams: [
        {
          id: "t1",
          name: "Design",
          isDefault: true,
          role: "reviewer",
          canPublish: false,
          canManage: false,
        },
        { id: "t2", name: "Legacy" },
      ],
    });
    expect(parsed.teams[0]).toMatchObject({ role: "reviewer", canPublish: false });
    expect(parsed.teams[1]?.canPublish).toBeUndefined();
  });

  test("a link's audience and public commenting are read when present", () => {
    expect(
      LinkResponseSchema.parse({
        slug: "s",
        audience: [{ type: "team", id: "t1", name: "Design" }],
        publicComments: true,
      }),
    ).toMatchObject({ audience: [{ type: "team", name: "Design" }], publicComments: true });
  });

  test("a published design may withhold its owner's email", () => {
    const row = PublishedDesignSchema.parse({
      slug: "s",
      title: null,
      url: "/s/s/",
      visibility: "private",
      passwordProtected: false,
      canManage: false,
      mine: false,
      ownerEmail: null,
      ownerName: "Ana",
      teamName: "Design",
      published: true,
      lastPublishedAt: null,
    });
    expect(row).toMatchObject({ ownerEmail: null, ownerName: "Ana", teamName: "Design" });
  });
});
