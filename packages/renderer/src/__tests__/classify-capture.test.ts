import { describe, expect, test } from "bun:test";
import { classifyCapture } from "../screenshot.ts";

describe("classifyCapture", () => {
  test("same page (trailing slash / query / hash ignored) is not a redirect", () => {
    expect(
      classifyCapture("http://localhost:3000/pricing", "http://localhost:3000/pricing"),
    ).toEqual({ redirected: false, finalLooksLikeLogin: false, requestedLooksLikeLogin: false });
    expect(
      classifyCapture("http://localhost:3000/pricing", "http://localhost:3000/pricing/?x=1#y")
        .redirected,
    ).toBe(false);
    expect(classifyCapture("http://localhost:3000/", "http://localhost:3000").redirected).toBe(
      false,
    );
  });

  test("redirect to a login page is flagged on both counts", () => {
    const c = classifyCapture(
      "http://localhost:3000/onboarding/plan",
      "http://localhost:3000/login?next=/onboarding/plan",
    );
    expect(c.redirected).toBe(true);
    expect(c.finalLooksLikeLogin).toBe(true);
    expect(c.requestedLooksLikeLogin).toBe(false);
  });

  test("intentionally porting the login page: requestedLooksLikeLogin true, no redirect", () => {
    const c = classifyCapture("http://localhost:3000/login", "http://localhost:3000/login");
    expect(c.redirected).toBe(false);
    expect(c.requestedLooksLikeLogin).toBe(true);
  });

  test("redirect to a different non-login path still counts as redirected", () => {
    const c = classifyCapture("http://localhost:3000/app", "http://localhost:3000/welcome");
    expect(c.redirected).toBe(true);
    expect(c.finalLooksLikeLogin).toBe(false);
  });

  test("cross-origin redirect is a redirect", () => {
    expect(
      classifyCapture("http://localhost:3000/pricing", "https://auth.example.com/signin")
        .redirected,
    ).toBe(true);
  });
});
