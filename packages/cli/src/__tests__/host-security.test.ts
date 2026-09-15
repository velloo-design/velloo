import { describe, expect, test } from "bun:test";
import { assertLoopbackHost, isLoopbackHost } from "../host-security.ts";

describe("loopback bind gate", () => {
  test.each(["localhost", "LOCALHOST.", "127.0.0.1", "127.12.34.56", "::1", "[::1]"])(
    "accepts loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => assertLoopbackHost(host)).not.toThrow();
    },
  );

  test.each(["0.0.0.0", "::", "192.168.1.20", "velloo.local", "example.com"])(
    "rejects non-loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => assertLoopbackHost(host)).toThrow(/only serve loopback/);
    },
  );
});
