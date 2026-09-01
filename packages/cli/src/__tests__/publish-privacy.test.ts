import { describe, expect, test } from "bun:test";
import { resolvePublishPrivacy } from "../publish/privacy.ts";

describe("publish privacy selection", () => {
  test("prompts when no privacy mode was supplied", async () => {
    let prompts = 0;
    const choice = await resolvePublishPrivacy({}, true, async () => {
      prompts += 1;
      return "private";
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

    expect(await resolvePublishPrivacy({ private: true }, true, choose)).toEqual({
      visibility: "private",
      password: false,
    });
    expect(await resolvePublishPrivacy({ public: true }, true, choose)).toEqual({
      visibility: "public",
      password: false,
    });
    expect(await resolvePublishPrivacy({ password: true }, true, choose)).toEqual({
      visibility: "public",
      password: true,
    });
    expect(await resolvePublishPrivacy({ visibility: "private" }, true, choose)).toEqual({
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
