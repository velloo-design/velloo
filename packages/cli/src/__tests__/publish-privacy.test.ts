import { describe, expect, test } from "bun:test";
import { httpFailure } from "@velloo/protocol";
import { describePublishError } from "../publish/errors.ts";
import { privacyFlagsError, resolvePublishPrivacy } from "../publish/privacy.ts";

describe("publish privacy selection", () => {
  test("prompts when no privacy mode was supplied", async () => {
    let prompts = 0;
    const choice = await resolvePublishPrivacy({}, true, {
      choose: async () => {
        prompts += 1;
        return "private";
      },
    });

    expect(prompts).toBe(1);
    expect(choice).toEqual({ visibility: "private", password: false, teamOnly: false });
  });

  test("explicit modes skip the prompt", async () => {
    let prompts = 0;
    const choose = async () => {
      prompts += 1;
      return "private" as const;
    };

    expect(await resolvePublishPrivacy({ private: true }, true, { choose })).toEqual({
      visibility: "private",
      password: false,
      teamOnly: false,
    });
    expect(await resolvePublishPrivacy({ public: true }, true, { choose })).toEqual({
      visibility: "public",
      password: false,
      teamOnly: false,
    });
    expect(await resolvePublishPrivacy({ password: true }, true, { choose })).toEqual({
      visibility: "public",
      password: true,
      teamOnly: false,
    });
    expect(await resolvePublishPrivacy({ visibility: "private" }, true, { choose })).toEqual({
      visibility: "private",
      password: false,
      teamOnly: false,
    });
    expect(prompts).toBe(0);
  });

  test("non-interactive publish requires an explicit mode", async () => {
    expect(resolvePublishPrivacy({}, false)).rejects.toThrow("privacy mode is required");
  });

  test("rejects conflicting explicit flags", async () => {
    expect(resolvePublishPrivacy({ private: true, public: true }, false)).rejects.toThrow(
      "cannot be used together",
    );
    expect(resolvePublishPrivacy({ private: true, visibility: "public" }, false)).rejects.toThrow(
      "conflicts",
    );
  });
});

describe("publish privacy on a free plan", () => {
  test("protected flags are refused up front, naming the way out but no plan", () => {
    for (const args of [{ private: true }, { password: true }, { visibility: "private" }]) {
      const message = privacyFlagsError(args, false);
      expect(message).toContain("need a paid plan");
      expect(message).toContain("--public");
      // No billing URL resolved, so it names the page rather than a guess.
      expect(message).toContain("upgrade from your cloud's billing page");
      expect(message).not.toContain("pricing");
    }
    expect(privacyFlagsError({ private: true }, false, "http://localhost:7401/billing")).toContain(
      "upgrade at http://localhost:7401/billing",
    );
    expect(privacyFlagsError({ public: true }, false)).toBeNull();
    expect(privacyFlagsError({ private: true }, true)).toBeNull();
  });

  test("the prompt is told the plan, and public still resolves", async () => {
    let offered: boolean | undefined;
    const choice = await resolvePublishPrivacy({}, true, {
      protectedShares: false,
      choose: async ({ protectedShares }) => {
        offered = protectedShares;
        return "public";
      },
      askPublicComments: async () => false,
    });
    expect(offered).toBe(false);
    expect(choice).toEqual({
      visibility: "public",
      password: false,
      teamOnly: false,
      publicComments: false,
    });
  });

  test("a protected answer the plan cannot honor never reaches the cloud", async () => {
    expect(
      resolvePublishPrivacy({}, true, { protectedShares: false, choose: async () => "password" }),
    ).rejects.toThrow("need a paid plan");
  });

  test("the cloud's own refusal reads as the same sentence, not a status line", () => {
    const message = describePublishError(
      httpFailure("link creation", 403, "protected shares require Team or Business", "forbidden"),
    );
    expect(message).not.toContain("(403)");
    expect(message).toContain("free accounts publish public links only");
    expect(message).toContain("billing page");
    expect(message).not.toContain("pricing");
  });
});

describe("team-only links", () => {
  const team = { name: "Design" };

  test("--team-only is a private link for the publish's team", async () => {
    expect(await resolvePublishPrivacy({ "team-only": true }, false, { team })).toEqual({
      visibility: "private",
      password: false,
      teamOnly: true,
    });
  });

  test("--team-only needs a team, a paid plan, and no --public", async () => {
    expect(resolvePublishPrivacy({ "team-only": true }, false)).rejects.toThrow(
      "needs an organization team",
    );
    expect(privacyFlagsError({ "team-only": true }, false)).toContain("paid plan");
    expect(privacyFlagsError({ "team-only": true, public: true })).toContain("--public");
    expect(privacyFlagsError({ "team-only": true, visibility: "public" })).toContain("--public");
  });

  test("the prompt offers the team by name only when asked to", async () => {
    const offered: (string | undefined)[] = [];
    const choose = async ({ teamName }: { teamName?: string | undefined }) => {
      offered.push(teamName);
      return teamName ? ("team" as const) : ("private" as const);
    };
    expect(await resolvePublishPrivacy({}, true, { team, offerTeamOnly: true, choose })).toEqual({
      visibility: "private",
      password: false,
      teamOnly: true,
    });
    expect(await resolvePublishPrivacy({}, true, { team, choose })).toEqual({
      visibility: "private",
      password: false,
      teamOnly: false,
    });
    expect(offered).toEqual(["Design", undefined]);
  });
});

describe("public commenting", () => {
  test("asked after an interactive public or password choice, not for private", async () => {
    let asked = 0;
    const askPublicComments = async () => {
      asked += 1;
      return true;
    };
    expect(
      await resolvePublishPrivacy({}, true, { choose: async () => "password", askPublicComments }),
    ).toEqual({ visibility: "public", password: true, teamOnly: false, publicComments: true });
    expect(
      await resolvePublishPrivacy({}, true, { choose: async () => "private", askPublicComments }),
    ).toEqual({ visibility: "private", password: false, teamOnly: false });
    expect(asked).toBe(1);
  });

  test("flags decide without asking; a flagged publish is never prompted", async () => {
    const askPublicComments = async (): Promise<boolean> => {
      throw new Error("should not ask");
    };
    expect(
      await resolvePublishPrivacy({ public: true, "public-comments": true }, true, {
        askPublicComments,
      }),
    ).toEqual({ visibility: "public", password: false, teamOnly: false, publicComments: true });
    expect(
      await resolvePublishPrivacy({ password: true, "public-comments": false }, false),
    ).toEqual({ visibility: "public", password: true, teamOnly: false, publicComments: false });
    expect(await resolvePublishPrivacy({ public: true }, true, { askPublicComments })).toEqual({
      visibility: "public",
      password: false,
      teamOnly: false,
    });
  });

  test("--public-comments on a private link is dropped with a warning", async () => {
    const warnings: string[] = [];
    const choice = await resolvePublishPrivacy({ private: true, "public-comments": true }, false, {
      warn: (message) => warnings.push(message),
    });
    expect(choice).toEqual({ visibility: "private", password: false, teamOnly: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--public-comments ignored");
  });
});
