import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hostIsLoopback, localOnlyMiddleware, requestIsLocal } from "../security.ts";

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

  test("rejects a page served by another local server (a different port or loopback name)", () => {
    expect(requestIsLocal({ host: "localhost:7300", origin: "http://localhost:3000" })).toBe(false);
    expect(requestIsLocal({ host: "127.0.0.1:7300", origin: "http://127.0.0.1:5173" })).toBe(false);
    expect(requestIsLocal({ host: "127.0.0.1:7300", origin: "http://localhost:7300" })).toBe(false);
    expect(requestIsLocal({ host: "[::1]:7300", origin: "http://[::1]:7301" })).toBe(false);
    expect(requestIsLocal({ host: "localhost:7300", origin: "http://localhost" })).toBe(false);
  });

  test("allows the Vite dev server's proxied requests (its own Host and Origin)", () => {
    expect(requestIsLocal({ host: "localhost:7301", origin: "http://localhost:7301" })).toBe(true);
  });

  test("compares the Origin the way the browser normalizes it", () => {
    expect(requestIsLocal({ host: "[::1]:7300", origin: "http://[::1]:7300" })).toBe(true);
    expect(requestIsLocal({ host: "localhost", origin: "http://localhost:80" })).toBe(true);
    expect(requestIsLocal({ host: "localhost:7300", origin: "file://localhost:7300" })).toBe(false);
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

describe("localOnlyMiddleware", () => {
  const app = new Hono();
  app.use("*", localOnlyMiddleware());
  app.all("*", (c) => c.text("ok"));
  const call = (path: string, init: { method?: string; origin?: string; host?: string } = {}) =>
    app.request(`http://${init.host ?? "127.0.0.1:7300"}${path}`, {
      method: init.method ?? "GET",
      headers: init.origin ? { origin: init.origin } : {},
    });

  test("capture pages (Origin: null) may import the client-mount bundles", async () => {
    expect((await call("/api/canvas/bundle.js?refs=x", { origin: "null" })).status).toBe(200);
    expect((await call("/api/live/bundle.js", { origin: "null" })).status).toBe(200);
  });

  test("but nothing else, and never across a rebinding Host or with a write", async () => {
    expect((await call("/api/design", { origin: "null" })).status).toBe(403);
    expect(
      (await call("/api/canvas/runtime-diagnostics", { method: "POST", origin: "null" })).status,
    ).toBe(403);
    expect(
      (await call("/api/canvas/bundle.js", { origin: "null", host: "attacker.com:7300" })).status,
    ).toBe(403);
    expect((await call("/api/canvas/bundle.js", { origin: "https://evil.example" })).status).toBe(
      403,
    );
  });

  test("a CORS-simple POST from another local port cannot reach a mutating route", async () => {
    const res = await app.request("http://127.0.0.1:7300/api/mutate", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "text/plain" },
      body: JSON.stringify({ op: "delete_screen", screenId: "home" }),
    });
    expect(res.status).toBe(403);
    expect(
      (await call("/api/publish", { method: "POST", origin: "http://127.0.0.1:3000" })).status,
    ).toBe(403);
  });

  test("the canvas's own same-origin requests and origin-less CLI calls still pass", async () => {
    expect(
      (await call("/api/mutate", { method: "POST", origin: "http://127.0.0.1:7300" })).status,
    ).toBe(200);
    expect((await call("/api/mutate", { method: "POST" })).status).toBe(200);
  });
});
