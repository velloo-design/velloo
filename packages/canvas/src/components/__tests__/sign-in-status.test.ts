import { describe, expect, test } from "bun:test";
import { type AuthStatus, credentialJustRejected, loginAttemptSucceeded } from "../../api/auth.ts";

const status = (overrides: Partial<AuthStatus>): AuthStatus => ({
  loggedIn: false,
  verified: null,
  login: { state: "idle" },
  ...overrides,
});

describe("loginAttemptSucceeded", () => {
  test("does not treat an old credential as success while replacement approval is pending", () => {
    expect(
      loginAttemptSucceeded(
        status({
          loggedIn: true,
          verified: false,
          account: { email: "old@b.dev" },
          login: {
            state: "pending",
            userCode: "WDJB-MJHT",
            verificationUrl: "https://app.example.test/device?user_code=WDJB-MJHT",
            expiresAt: "2026-08-25T15:00:00.000Z",
          },
        }),
      ),
    ).toBe(false);
  });

  test("requires both a persisted credential and a completed attempt", () => {
    expect(loginAttemptSucceeded(status({ loggedIn: true, verified: true }))).toBe(true);
    expect(
      loginAttemptSucceeded(
        status({ loggedIn: true, login: { state: "error", message: "access denied" } }),
      ),
    ).toBe(false);
    expect(loginAttemptSucceeded(status({ loggedIn: false }))).toBe(false);
  });
});

describe("credentialJustRejected", () => {
  const rejected = status({ loggedIn: true, verified: false, account: { email: "a@b.dev" } });

  test("fires once on the edge, not on every poll that finds the same state", () => {
    expect(credentialJustRejected(null, rejected)).toBe(true);
    expect(credentialJustRejected(status({ loggedIn: true, verified: true }), rejected)).toBe(true);
    expect(credentialJustRejected(rejected, rejected)).toBe(false);
  });

  test("an unreachable cloud is not a rejection", () => {
    // `verified: null` means the daemon could not ask. Announcing an ended
    // session on a dropped connection would send people to re-authenticate
    // over a working credential.
    expect(credentialJustRejected(null, status({ loggedIn: true, verified: null }))).toBe(false);
  });

  test("signing out is not a rejection either — the user did that on purpose", () => {
    expect(credentialJustRejected(rejected, status({ loggedIn: false }))).toBe(false);
  });
});
