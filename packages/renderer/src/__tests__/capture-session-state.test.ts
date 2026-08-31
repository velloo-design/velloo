import { describe, expect, test } from "bun:test";
import {
  registrableDomain,
  SESSION_TTL_MS,
  type StorageState,
  scopeStorageState,
  sessionExpired,
  withinRegistrableDomain,
} from "../capture-session-state.ts";

const cookie = (name: string, domain: string, expires = -1) => ({
  name,
  value: `${name}-value`,
  domain,
  path: "/",
  expires,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
});

describe("registrableDomain", () => {
  test("takes two labels under a generic TLD", () => {
    expect(registrableDomain("app.example.com")).toBe("example.com");
    expect(registrableDomain("example.com")).toBe("example.com");
    expect(registrableDomain("a.b.c.example.org")).toBe("example.org");
  });

  test("takes three labels under a country second-level suffix", () => {
    expect(registrableDomain("app.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com.au")).toBe("example.com.au");
  });

  test("leaves literal hosts alone", () => {
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
  });

  test("ignores a leading cookie-domain dot and case", () => {
    expect(registrableDomain(".App.Example.com")).toBe("example.com");
  });
});

describe("withinRegistrableDomain", () => {
  test("matches the base and its subdomains only", () => {
    expect(withinRegistrableDomain("example.com", "example.com")).toBe(true);
    expect(withinRegistrableDomain("auth.example.com", "example.com")).toBe(true);
    expect(withinRegistrableDomain("notexample.com", "example.com")).toBe(false);
    expect(withinRegistrableDomain("example.com.evil.net", "example.com")).toBe(false);
  });
});

describe("scopeStorageState", () => {
  const state: StorageState = {
    cookies: [
      cookie("session", "app.example.com"),
      cookie("sso", "auth.example.com"),
      cookie("wide", ".example.com"),
      cookie("google", ".google.com"),
      cookie("github", "github.com"),
    ],
    origins: [
      { origin: "https://app.example.com", localStorage: [{ name: "jwt", value: "x" }] },
      { origin: "https://accounts.google.com", localStorage: [{ name: "g", value: "y" }] },
    ],
  };

  test("keeps the target site including sibling subdomains", () => {
    const scoped = scopeStorageState(state, ["https://app.example.com"]);
    const names = scoped.cookies.map((c) => c.name).sort();
    // auth.example.com is where a post-OAuth session often lives, so it stays.
    expect(names).toEqual(["session", "sso", "wide"]);
  });

  test("drops third-party identity-provider cookies", () => {
    const scoped = scopeStorageState(state, ["https://app.example.com"]);
    expect(scoped.cookies.some((c) => c.name === "google")).toBe(false);
    expect(scoped.cookies.some((c) => c.name === "github")).toBe(false);
  });

  test("scopes localStorage origins the same way", () => {
    const scoped = scopeStorageState(state, ["https://app.example.com"]);
    expect(scoped.origins.map((o) => o.origin)).toEqual(["https://app.example.com"]);
  });

  test("prunes cookies that already expired", () => {
    const now = 1_000_000_000_000;
    const withExpired: StorageState = {
      cookies: [
        cookie("dead", "app.example.com", Math.floor(now / 1000) - 60),
        cookie("alive", "app.example.com", Math.floor(now / 1000) + 60),
      ],
      origins: [],
    };
    const scoped = scopeStorageState(withExpired, ["https://app.example.com"], now);
    expect(scoped.cookies.map((c) => c.name)).toEqual(["alive"]);
  });

  test("a malformed captured origin scopes nothing rather than everything", () => {
    const scoped = scopeStorageState(state, ["not a url"]);
    expect(scoped.cookies).toEqual([]);
    expect(scoped.origins).toEqual([]);
  });

  test("multiple captured origins each contribute a scope", () => {
    const scoped = scopeStorageState(state, ["https://app.example.com", "https://github.com/x"]);
    expect(scoped.cookies.some((c) => c.name === "github")).toBe(true);
    expect(scoped.cookies.some((c) => c.name === "google")).toBe(false);
  });
});

describe("sessionExpired", () => {
  test("is false inside the TTL and true past it", () => {
    const now = Date.now();
    expect(sessionExpired(now - 1000, now)).toBe(false);
    expect(sessionExpired(now - SESSION_TTL_MS - 1000, now)).toBe(true);
  });
});
