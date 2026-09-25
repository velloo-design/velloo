import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RSABSSA } from "@cloudflare/blindrsa-ts";
import { Hono } from "hono";
import type { CloudAuth } from "../../cloud.ts";
import { TOKEN_SCHEME } from "../../feedback-tokens.ts";
import { createFeedbackRouter } from "../feedback.ts";

/**
 * The canvas's own feedback button. A stub cloud runs the real blind-signing
 * issuer, so the anonymous path is proven end to end — including that it
 * carries no account credential — alongside the authenticated one.
 */

const suite = RSABSSA.SHA384.PSS.Randomized();
const pair = await suite.generateKey({
  publicExponent: Uint8Array.from([1, 0, 1]),
  modulusLength: 2048,
});
const spkiB64 = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString(
  "base64",
);

interface Received {
  path: string;
  authorization: string | null;
  body: Record<string, unknown>;
}
let received: Received[] = [];
let feedbackStatus = 201;

const cloudServer = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/feedback/token-key") {
      return Response.json({ scheme: TOKEN_SCHEME, publicKey: spkiB64 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    received.push({ path: url.pathname, authorization: req.headers.get("authorization"), body });
    if (url.pathname === "/v1/feedback/tokens") {
      const signatures: string[] = [];
      for (const blinded of body.blinded as string[]) {
        const sig = await suite.blindSign(pair.privateKey, Buffer.from(blinded, "base64"));
        signatures.push(Buffer.from(sig).toString("base64"));
      }
      return Response.json({ scheme: TOKEN_SCHEME, signatures });
    }
    if (url.pathname === "/v1/feedback" || url.pathname === "/v1/feedback/anonymous") {
      return Response.json({ id: "f1" }, { status: feedbackStatus });
    }
    return new Response(null, { status: 404 });
  },
});
const cloudUrl = `http://127.0.0.1:${cloudServer.port}`;
afterAll(() => cloudServer.stop(true));

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `velloo-feedback-route-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  received = [];
  feedbackStatus = 201;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function app(cloud: CloudAuth | undefined): Hono {
  return new Hono().route(
    "/api/feedback",
    createFeedbackRouter(cloud, () => "0.9.0", {
      tokenStorePath: join(dir, "feedback-tokens.json"),
    }),
  );
}

const send = (server: Hono, body: unknown) =>
  server.request("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { kind: string; message: string } }).error;

describe("feedback route", () => {
  test("sends with the account when the user opts out of anonymity", async () => {
    const response = await send(app({ url: cloudUrl, token: "vlk_user" }), {
      kind: "bug",
      body: "  The inspector jumps when I resize.  ",
      anonymous: false,
    });
    expect(response.status).toBe(200);
    expect(received).toEqual([
      {
        path: "/v1/feedback",
        authorization: "Bearer vlk_user",
        body: {
          body: "The inspector jumps when I resize.",
          source: "canvas",
          kind: "bug",
          toolVersion: "0.9.0",
          contactOk: true,
        },
      },
    ]);
  });

  test("sends anonymously by spending a blind token, with no credential on the send", async () => {
    const response = await send(app({ url: cloudUrl, token: "vlk_user" }), {
      kind: "feedback",
      body: "Love the board badges.",
      anonymous: true,
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { message: string }).message).toContain("anonymously");
    const issued = received.find((entry) => entry.path === "/v1/feedback/tokens");
    expect(issued?.authorization).toBe("Bearer vlk_user");
    const anonymous = received.find((entry) => entry.path === "/v1/feedback/anonymous");
    expect(anonymous?.authorization).toBeNull();
    expect(anonymous?.body).toMatchObject({
      body: "Love the board badges.",
      source: "canvas",
      kind: "feedback",
      toolVersion: "0.9.0",
    });
    expect(received.some((entry) => entry.path === "/v1/feedback")).toBe(false);
  });

  test("uses the live credential, so signing in after the daemon started works", async () => {
    const response = await send(app({ url: cloudUrl, resolveToken: async () => "vlk_fresh" }), {
      kind: "feedback",
      body: "Signed in from the canvas.",
      anonymous: true,
    });
    expect(response.status).toBe(200);
    const issued = received.find((entry) => entry.path === "/v1/feedback/tokens");
    expect(issued?.authorization).toBe("Bearer vlk_fresh");
  });

  test("a signed-out canvas is told to sign in, and nothing is sent", async () => {
    const response = await send(app({ url: cloudUrl }), {
      kind: "bug",
      body: "Hello",
      anonymous: true,
    });
    expect(response.status).toBe(401);
    expect((await errorOf(response)).kind).toBe("LoggedOut");
    expect(received).toEqual([]);
  });

  test("a cloud refusal surfaces as a failure, not a thank-you", async () => {
    feedbackStatus = 500;
    const response = await send(app({ url: cloudUrl, token: "vlk_user" }), {
      kind: "bug",
      body: "Hello",
      anonymous: false,
    });
    expect(response.status).toBe(502);
    const error = await errorOf(response);
    expect(error.kind).toBe("HttpFailure");
    expect(error.message).toContain("500");
  });

  test("rejects an empty, oversized, or kindless message before reaching the cloud", async () => {
    const server = app({ url: cloudUrl, token: "vlk_user" });
    for (const body of [
      { kind: "bug", body: "   ", anonymous: true },
      { kind: "bug", body: "x".repeat(6001), anonymous: true },
      { body: "Hello", anonymous: true },
      { kind: "rant", body: "Hello", anonymous: true },
    ]) {
      const response = await send(server, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).kind).toBe("BadRequest");
    }
    expect(received).toEqual([]);
  });

  test("without a cloud there is nowhere to send", async () => {
    const response = await send(app(undefined), {
      kind: "bug",
      body: "Hello",
      anonymous: false,
    });
    expect(response.status).toBe(503);
  });
});
