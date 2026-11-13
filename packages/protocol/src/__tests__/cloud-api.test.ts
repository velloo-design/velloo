import { describe, expect, test } from "bun:test";
import {
  creditAmount,
  formatCredits,
  LinkResponseSchema,
  PublishedDesignSchema,
  TeamsResponseSchema,
} from "../cloud-api.ts";

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

describe("formatCredits", () => {
  test("shows micros as whole credits, grouped, and singular for one", () => {
    expect(formatCredits(38_000)).toBe("38 credits");
    expect(formatCredits(11_750_000)).toBe("11,750 credits");
    expect(formatCredits(1_000)).toBe("1 credit");
    expect(formatCredits(0)).toBe("0 credits");
    expect(creditAmount(4_320_000)).toBe("4,320");
  });

  test("keeps a tenth of a credit a balance from before whole-credit prices can carry", () => {
    expect(formatCredits(1_234_560)).toBe("1,234.6 credits");
  });
});
