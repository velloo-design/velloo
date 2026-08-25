import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RSABSSA } from "@cloudflare/blindrsa-ts";
import { sendAnonymousFeedback, TOKEN_SCHEME, topUpTokens } from "../feedback-tokens.ts";

/**
 * Exercises the client half of the blind-token flow against a stub cloud
 * that runs the REAL issuer side (same RFC 9474 suite) — so the test proves
 * the two halves interoperate and, crucially, that the anonymous send
 * carries no account credential.
 */

const suite = RSABSSA.SHA384.PSS.Randomized();
const pair = await suite.generateKey({
  publicExponent: Uint8Array.from([1, 0, 1]),
  modulusLength: 2048,
});
const spkiB64 = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString(
  "base64",
);

interface Seen {
  issueAuthHeaders: (string | null)[];
  anonAuthHeaders: (string | null)[];
  anonBodies: Record<string, unknown>[];
}
const seen: Seen = { issueAuthHeaders: [], anonAuthHeaders: [], anonBodies: [] };
const spent = new Set<string>();
let publicKeyB64 = spkiB64;

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/v1/feedback/token-key") {
      return Response.json({ scheme: TOKEN_SCHEME, publicKey: publicKeyB64 });
    }
    if (url.pathname === "/v1/feedback/tokens") {
      seen.issueAuthHeaders.push(req.headers.get("authorization"));
      if (!req.headers.get("authorization")) return new Response(null, { status: 401 });
      const { blinded } = (await req.json()) as { blinded: string[] };
      const signatures: string[] = [];
      for (const b of blinded) {
        const sig = await suite.blindSign(pair.privateKey, Buffer.from(b, "base64"));
        signatures.push(Buffer.from(sig).toString("base64"));
      }
      return Response.json({ scheme: TOKEN_SCHEME, signatures });
    }
    if (url.pathname === "/v1/feedback/anonymous") {
      seen.anonAuthHeaders.push(req.headers.get("authorization"));
      const body = (await req.json()) as { token: string; signature: string };
      seen.anonBodies.push(body);
      const token = Buffer.from(body.token, "base64");
      const ok = await suite.verify(pair.publicKey, Buffer.from(body.signature, "base64"), token);
      if (!ok) return new Response(null, { status: 401 });
      const hash = Buffer.from(token).toString("hex");
      if (spent.has(hash)) return new Response(null, { status: 409 });
      spent.add(hash);
      return Response.json({ id: "f1", code: "A-DEADBEEF" }, { status: 201 });
    }
    return new Response(null, { status: 404 });
  },
});
const cloudUrl = `http://127.0.0.1:${server.port}`;

let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = join(tmpdir(), `velloo-fbtok-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  storePath = join(dir, "feedback-tokens.json");
  publicKeyB64 = spkiB64;
  seen.issueAuthHeaders.length = 0;
  seen.anonAuthHeaders.length = 0;
  seen.anonBodies.length = 0;
});

afterAll(async () => {
  server.stop(true);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("feedback tokens (client)", () => {
  test("topUpTokens blinds, fetches, verifies, and stores a batch", async () => {
    await topUpTokens({ url: cloudUrl, token: "vlk_test" }, 1, storePath);
    const store = JSON.parse(await readFile(storePath, "utf8")) as Record<
      string,
      { publicKey: string; tokens: unknown[] }
    >;
    const entry = store[cloudUrl];
    expect(entry?.tokens.length).toBe(10);
    expect(entry?.publicKey).toBe(spkiB64);
    // Issuance is the authenticated half.
    expect(seen.issueAuthHeaders).toEqual(["Bearer vlk_test"]);
    // Enough already stored → a second call is a no-op.
    await topUpTokens({ url: cloudUrl, token: "vlk_test" }, 1, storePath);
    expect(seen.issueAuthHeaders.length).toBe(1);
  }, 20_000);

  test("sendAnonymousFeedback carries no credential and burns one token", async () => {
    await topUpTokens({ url: cloudUrl, token: "vlk_test" }, 1, storePath);
    const result = await sendAnonymousFeedback(
      { url: cloudUrl, token: "vlk_test" },
      { body: "the style pane confused me", toolVersion: "0.1.0" },
      storePath,
    );
    expect(result.ok).toBe(true);
    // THE property: the anonymous request has no authorization header.
    expect(seen.anonAuthHeaders).toEqual([null]);
    expect(seen.anonBodies[0]?.body).toBe("the style pane confused me");
    const store = JSON.parse(await readFile(storePath, "utf8")) as Record<
      string,
      { tokens: unknown[] }
    >;
    expect(store[cloudUrl]?.tokens.length).toBe(9);
  }, 20_000);

  test("an issuer key change after first issuance is refused (TOFU)", async () => {
    await topUpTokens({ url: cloudUrl, token: "vlk_test" }, 1, storePath);
    const rotated = await suite.generateKey({
      publicExponent: Uint8Array.from([1, 0, 1]),
      modulusLength: 2048,
    });
    publicKeyB64 = Buffer.from(await crypto.subtle.exportKey("spki", rotated.publicKey)).toString(
      "base64",
    );
    // Force a top-up past the stored batch: ask for more than we hold.
    await expect(topUpTokens({ url: cloudUrl, token: "vlk_test" }, 11, storePath)).rejects.toThrow(
      /issuer key changed/,
    );
  }, 20_000);

  test("signed out with an empty store fails with guidance, not a crash", async () => {
    const result = await sendAnonymousFeedback({ url: cloudUrl }, { body: "hello" }, storePath);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("velloo login");
  });
});
