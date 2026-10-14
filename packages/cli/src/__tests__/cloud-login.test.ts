import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// The flow opens the person's browser; a test has none to open.
mock.module("../open-url.ts", () => ({ openUrl: async () => {} }));
const { performDeviceLogin } = await import("../cloud-login.ts");

/**
 * The sign-in polls the auth service until the person approves the code. A
 * rate-limited poll is a reason to slow down, not to give up: the auth service
 * answers one 429 with `{ message }`, which the flow used to read as a refusal
 * and end the sign-in the person was still approving.
 */
let server: ReturnType<typeof Bun.serve>;
let polls: number[] = [];
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const origin = `http://127.0.0.1:${server.port}`;
      if (pathname === "/v1/auth/config") return Response.json({ issuer: origin, clientId: "cli" });
      if (pathname === "/api/auth/device/code") {
        return Response.json({
          device_code: "dev",
          user_code: "CODE",
          verification_uri: `${origin}/device`,
          verification_uri_complete: `${origin}/device?user_code=CODE`,
          expires_in: 30,
          interval: 1,
        });
      }
      if (pathname === "/api/auth/device/token") {
        polls.push(Date.now());
        if (polls.length === 1) {
          return Response.json(
            { message: "Too many requests. Please try again later." },
            { status: 429, headers: { "x-retry-after": "1" } },
          );
        }
        if (polls.length === 2)
          return Response.json({ error: "authorization_pending" }, { status: 400 });
        return Response.json({ access_token: "at" });
      }
      if (pathname === "/v1/auth/cli-token") {
        return Response.json({ token: "vlk_test", email: "a@example.com" }, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));

describe("polling for the sign-in", () => {
  test("a rate-limited poll waits and polls again, and the sign-in completes", async () => {
    polls = [];
    const result = await performDeviceLogin(`http://127.0.0.1:${server.port}`, () => {});
    expect(result).toEqual({ token: "vlk_test", email: "a@example.com" });
    expect(polls).toHaveLength(3);
  }, 20_000);
});
