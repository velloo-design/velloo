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
    expect(choice).toEqual({ visibility: "private", password: false });
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
    });
    expect(await resolvePublishPrivacy({ public: true }, true, { choose })).toEqual({
      visibility: "public",
      password: false,
    });
    expect(await resolvePublishPrivacy({ password: true }, true, { choose })).toEqual({
      visibility: "public",
      password: true,
    });
    expect(await resolvePublishPrivacy({ visibility: "private" }, true, { choose })).toEqual({
      visibility: "private",
      password: false,
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
  test("protected flags are refused up front, naming the plan and the way out", () => {
    for (const args of [{ private: true }, { password: true }, { visibility: "private" }]) {
      const message = privacyFlagsError(args, false);
      expect(message).toContain("Team or Business");
      expect(message).toContain("--public");
      expect(message).toContain("velloo.design/pricing");
    }
    expect(privacyFlagsError({ public: true }, false)).toBeNull();
    expect(privacyFlagsError({ private: true }, true)).toBeNull();
  });

  test("the prompt is told the plan, and public still resolves", async () => {
    let offered: boolean | undefined;
    const choice = await resolvePublishPrivacy({}, true, {
      protectedShares: false,
      choose: async (protectedShares) => {
        offered = protectedShares;
        return "public";
      },
    });
    expect(offered).toBe(false);
    expect(choice).toEqual({ visibility: "public", password: false });
  });

  test("a protected answer the plan cannot honor never reaches the cloud", async () => {
    expect(
      resolvePublishPrivacy({}, true, { protectedShares: false, choose: async () => "password" }),
    ).rejects.toThrow("Team or Business");
  });

  test("the cloud's own refusal reads as the same sentence, not a status line", () => {
    const message = describePublishError(
      httpFailure("link creation", 403, "protected shares require Team or Business", "forbidden"),
    );
    expect(message).not.toContain("(403)");
    expect(message).toContain("free accounts publish public links only");
    expect(message).toContain("velloo.design/pricing");
  });
});
