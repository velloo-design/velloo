import { describe, expect, test } from "bun:test";
import { hostIsLoopback, requestIsLocal } from "../security.ts";

describe("requestIsLocal", () => {
  test("allows loopback Host with no Origin (CLI probe, tests)", () => {
    expect(requestIsLocal({ host: "localhost:7300", origin: undefined })).toBe(true);
    expect(requestIsLocal({ host: "127.0.0.1:7300", origin: null })).toBe(true);
    expect(requestIsLocal({ host: "localhost", origin: undefined })).toBe(true);
    expect(requestIsLocal({ host: "[::1]:7300", origin: undefined })).toBe(true);
  });

  test("allows a same-origin loopback request (the canvas SPA)", () => {
    expect(requestIsLocal({ host: "localhost:7300", origin: "http://localhost:7300" })).toBe(true);
    expect(requestIsLocal({ host: "127.0.0.1:7300", origin: "http://127.0.0.1:7300" })).toBe(true);
  });

  test("rejects a cross-origin fetch to localhost (CSRF)", () => {
    expect(requestIsLocal({ host: "localhost:7300", origin: "https://evil.example" })).toBe(false);
    expect(requestIsLocal({ host: "127.0.0.1:7300", origin: "http://attacker.test" })).toBe(false);
  });

  test("rejects a rebinding request (non-loopback Host)", () => {
    expect(requestIsLocal({ host: "attacker.com:7300", origin: "http://attacker.com" })).toBe(
      false,
    );
    expect(requestIsLocal({ host: "designtool.local:7300", origin: undefined })).toBe(false);
  });

  test("rejects a missing Host and a null/malformed Origin", () => {
    expect(requestIsLocal({ host: undefined, origin: undefined })).toBe(false);
    expect(requestIsLocal({ host: "localhost:7300", origin: "null" })).toBe(false);
    expect(requestIsLocal({ host: "localhost:7300", origin: "not a url" })).toBe(false);
  });
});

describe("hostIsLoopback", () => {
  test("accepts loopback hosts with or without a port", () => {
    expect(hostIsLoopback("localhost:7300")).toBe(true);
    expect(hostIsLoopback("127.0.0.1")).toBe(true);
    expect(hostIsLoopback("[::1]:7300")).toBe(true);
  });

  test("rejects a rebinding Host and a missing one", () => {
    expect(hostIsLoopback("attacker.com:7300")).toBe(false);
    expect(hostIsLoopback(undefined)).toBe(false);
  });
});
