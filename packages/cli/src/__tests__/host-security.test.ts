import { describe, expect, test } from "bun:test";
import { assertRemoteHostAllowed, isLoopbackHost } from "../host-security.ts";

describe("remote host safety gate", () => {
  test.each(["localhost", "LOCALHOST.", "127.0.0.1", "127.12.34.56", "::1", "[::1]"])(
    "accepts loopback host %s without an override",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => assertRemoteHostAllowed(host)).not.toThrow();
    },
  );

  test.each(["0.0.0.0", "::", "192.168.1.20", "velloo.local", "example.com"])(
    "rejects non-loopback host %s without the explicit unsafe flag",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => assertRemoteHostAllowed(host)).toThrow(/--unsafe-allow-remote/);
    },
  );

  test("allows a non-loopback host only with the explicit unsafe flag", () => {
    expect(() => assertRemoteHostAllowed("0.0.0.0", true)).not.toThrow();
  });
});
