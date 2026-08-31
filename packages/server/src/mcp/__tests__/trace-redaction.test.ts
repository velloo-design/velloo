import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../trace.ts";

describe("redactSecrets", () => {
  test("redacts session credentials passed to compare_to_url", () => {
    const params = {
      screenId: "pricing",
      url: "https://app.example.com/pricing",
      cookies: [{ name: "session", value: "super-secret" }],
      localStorage: { jwt: "ey.secret.token" },
      storageStatePath: "/home/u/.velloo/sessions/abc.json",
    };
    const out = redactSecrets(params) as Record<string, unknown>;
    expect(out.screenId).toBe("pricing");
    expect(out.url).toBe("https://app.example.com/pricing");
    expect(out.cookies).toBe("<redacted>");
    expect(out.localStorage).toBe("<redacted>");
    expect(out.storageStatePath).toBe("<redacted>");
    expect(JSON.stringify(out)).not.toContain("super-secret");
    expect(JSON.stringify(out)).not.toContain("ey.secret.token");
  });

  test("reaches credentials nested inside arrays and objects", () => {
    const out = redactSecrets({
      ops: [{ tool: "compare_to_url", args: { cookies: [{ value: "leak" }] } }],
    });
    expect(JSON.stringify(out)).not.toContain("leak");
  });

  test("is case-insensitive on the argument name", () => {
    const out = redactSecrets({ Authorization: "Bearer x", apiKey: "k" }) as Record<
      string,
      unknown
    >;
    expect(out.Authorization).toBe("<redacted>");
    expect(out.apiKey).toBe("<redacted>");
  });

  test("leaves ordinary design params untouched", () => {
    const params = { screenId: "s", path: [0, 1], props: { children: "Hello" } };
    expect(redactSecrets(params)).toEqual(params);
  });
});
