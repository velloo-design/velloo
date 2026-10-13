import { describe, expect, test } from "bun:test";
import { asksForPassword } from "../screenshot-helpers.ts";

/**
 * `compare_to_url` calls a capture an auth wall when it shows a password field
 * the page wasn't expected to have. A design with one of its own expects it:
 * every sign-up flow compared against its own implementation was "unverified"
 * until this said so.
 */
describe("asksForPassword", () => {
  const input = (type: string) => ({ $ref: "Box", props: { as: "input", type } });

  test("finds a password field anywhere in the tree", () => {
    expect(
      asksForPassword({
        $ref: "Box",
        children: [{ $ref: "Box", children: [input("email"), input("password")] }],
      }),
    ).toBe(true);
  });

  test("finds one held in a slot prop", () => {
    expect(asksForPassword({ $ref: "Field", props: { control: input("password") } })).toBe(true);
  });

  test("a form without one doesn't", () => {
    expect(asksForPassword({ $ref: "Box", children: [input("email"), input("text")] })).toBe(false);
  });

  test("text that merely mentions a password doesn't", () => {
    expect(
      asksForPassword({
        $ref: "Text",
        props: { children: "password" },
        children: ["type", "password"],
      }),
    ).toBe(false);
  });
});
