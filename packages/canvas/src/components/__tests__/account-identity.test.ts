import { describe, expect, test } from "bun:test";
import type { CloudAccount } from "../../api/auth.ts";
import { billingUrl, firstName, initials } from "../SettingsMenu.tsx";

/**
 * The signed-in trigger renders a person, so it has to survive every shape
 * velloo-cloud actually returns: a full name, a single name, no name at all.
 */
const account = (overrides: Partial<CloudAccount>): CloudAccount => ({
  email: "grace.hopper@example.com",
  ...overrides,
});

describe("firstName", () => {
  test("takes the given name, ignoring the rest", () => {
    expect(firstName(account({ name: "Grace Hopper" }))).toBe("Grace");
    expect(firstName(account({ name: "  Ada  Byron  King " }))).toBe("Ada");
    expect(firstName(account({ name: "Prince" }))).toBe("Prince");
  });

  test("falls back to the email's local part", () => {
    expect(firstName(account({}))).toBe("grace.hopper");
    expect(firstName(account({ name: "   " }))).toBe("grace.hopper");
  });
});

describe("initials", () => {
  test("uses given + family for a full name", () => {
    expect(initials(account({ name: "Grace Hopper" }))).toBe("GH");
    // Middle names don't crowd out the family initial.
    expect(initials(account({ name: "Ada Byron King" }))).toBe("AK");
  });

  test("uses the first two letters when there is only one word", () => {
    expect(initials(account({ name: "Prince" }))).toBe("PR");
    expect(initials(account({}))).toBe("GR");
  });
});

describe("billingUrl", () => {
  test("resolves /billing against the cloud's advertised home", () => {
    expect(billingUrl("https://app.velloo.dev")).toBe("https://app.velloo.dev/billing");
    // A trailing path on the base is replaced, not appended to.
    expect(billingUrl("https://app.velloo.dev/boards/")).toBe("https://app.velloo.dev/billing");
  });

  test("is null when there is no usable base", () => {
    expect(billingUrl(undefined)).toBeNull();
    expect(billingUrl("not a url")).toBeNull();
  });
});
