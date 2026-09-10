import { expect, test } from "bun:test";
import { boardLimitFrom, describeBoardLimit, httpFailure, loggedOut } from "../cloud-errors.ts";

/**
 * The cloud sends bare `forbidden` for every 403 it raises, so the one refusal
 * a user can clear themselves is recognized by its sentence. That makes the
 * cloud's wording a contract, and this is where it's pinned: a cloud that
 * rephrases it must fall back to the generic message rather than invent a
 * number.
 */

test("the plan's board cap is read out of the cloud's 403", () => {
  expect(
    boardLimitFrom(
      httpFailure("link creation", 403, "the free plan is limited to 3 active cloud boards"),
    ),
  ).toEqual({ tier: "free", limit: 3 });
});

test("a differently worded 403 yields no numbers to quote", () => {
  expect(boardLimitFrom(httpFailure("link creation", 403, "protected shares require Team"))).toBe(
    null,
  );
  expect(boardLimitFrom(httpFailure("link creation", 403, "unknown"))).toBe(null);
});

test("only a 403 can be the board cap", () => {
  expect(
    boardLimitFrom(
      httpFailure("link creation", 500, "the free plan is limited to 3 active cloud boards"),
    ),
  ).toBe(null);
  expect(boardLimitFrom(loggedOut("gone"))).toBe(null);
});

test("the shared sentence says what to do and pluralizes its count", () => {
  expect(describeBoardLimit({ tier: "free", limit: 3 })).toBe(
    "the free plan keeps 3 boards published at a time — take one down to publish another",
  );
  expect(describeBoardLimit({ tier: "free", limit: 1 })).toContain("keeps 1 board published");
});
