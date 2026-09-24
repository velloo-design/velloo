import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanvasAuth } from "@velloo/server";
import { saveCredential } from "../cloud-credentials.ts";
import { createCanvasPublish } from "../daemon/canvas-publish.ts";

/**
 * The canvas manages a board's guests through the daemon, which talks to the
 * cloud with the CLI's credential. These drive the real calls against a stub
 * cloud: the paths and bodies it sends, what comes back to the canvas, and the
 * plan refusal reworded so no surface names a plan.
 */

const GUEST_ID = "7c2f64e0-3f7a-4c56-9d0e-1b2a3c4d5e6f";
const guestRow = {
  id: GUEST_ID,
  name: "Ada",
  email: "ada@client.example",
  accountId: null,
  role: "guest",
  createdAt: "2030-01-01T00:00:00.000Z",
  lastSeenAt: null,
  linkExpiresAt: "2030-02-01T00:00:00.000Z",
};

let seen: { method: string; path: string; auth: string | null; body: unknown }[] = [];
let refuse: { status: number; message: string } | null = null;
let emailOn = true;

const cloud = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => null) : null;
    seen.push({ method: req.method, path: pathname, auth: req.headers.get("authorization"), body });
    if (refuse) {
      return Response.json(
        { error: "forbidden", message: refuse.message },
        { status: refuse.status },
      );
    }
    const invited = () =>
      Response.json(
        {
          guest: guestRow,
          delivery: emailOn ? { sent: true } : { sent: false, reason: "email is off" },
          ...(emailOn ? {} : { guestUrl: "http://share.test/s/review/g?t=one" }),
        },
        { status: pathname.endsWith("/guests") ? 201 : 200 },
      );
    if (pathname === "/v1/links/review/guests") {
      return req.method === "GET" ? Response.json({ guests: [guestRow] }) : invited();
    }
    if (pathname === `/v1/links/review/guests/${GUEST_ID}/resend`) return invited();
    if (pathname === `/v1/links/review/guests/${GUEST_ID}/link`) {
      return Response.json({ guest: guestRow, guestUrl: "http://share.test/s/review/g?t=two" });
    }
    if (pathname === `/v1/links/review/guests/${GUEST_ID}` && req.method === "DELETE") {
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
});
const cloudUrl = `http://127.0.0.1:${cloud.port}`;
const auth = { status: async () => ({ verified: true }) } as unknown as CanvasAuth;
const guests = () => createCanvasPublish(cloudUrl, auth).guests;

let dir: string;
const previous = process.env.VELLOO_CREDENTIALS_PATH;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-guests-"));
  process.env.VELLOO_CREDENTIALS_PATH = join(dir, "credentials.json");
  await saveCredential(cloudUrl, { token: "tok", email: "rae@example.com" });
});
afterEach(() => {
  seen = [];
  refuse = null;
  emailOn = true;
});
afterAll(async () => {
  cloud.stop(true);
  if (previous === undefined) delete process.env.VELLOO_CREDENTIALS_PATH;
  else process.env.VELLOO_CREDENTIALS_PATH = previous;
  await rm(dir, { recursive: true, force: true });
});

test("lists a board's guests with the account's bearer token", async () => {
  expect(await guests().list("review")).toEqual([
    {
      id: GUEST_ID,
      name: "Ada",
      email: "ada@client.example",
      createdAt: "2030-01-01T00:00:00.000Z",
      lastSeenAt: null,
      linkExpiresAt: "2030-02-01T00:00:00.000Z",
    },
  ]);
  expect(seen).toEqual([
    { method: "GET", path: "/v1/links/review/guests", auth: "Bearer tok", body: null },
  ]);
});

test("an emailed invite says so and carries no link", async () => {
  const invite = await guests().invite("review", { email: "ada@client.example", name: "Ada" });
  expect(invite).toMatchObject({ emailed: true, guest: { id: GUEST_ID } });
  expect(invite.guestUrl).toBeUndefined();
  expect(seen[0]?.body).toEqual({ email: "ada@client.example", name: "Ada" });
});

// With email off, the link is the only way the guest gets in.
test("an invite the cloud couldn't email hands the link back", async () => {
  emailOn = false;
  expect(await guests().invite("review", { email: "ada@client.example" })).toMatchObject({
    emailed: false,
    reason: "email is off",
    guestUrl: "http://share.test/s/review/g?t=one",
  });
  expect(seen[0]?.body).toEqual({ email: "ada@client.example" });
});

test("resend, a fresh link, and removal address the guest on its board", async () => {
  expect(await guests().resend("review", GUEST_ID)).toMatchObject({ emailed: true });
  expect(await guests().link("review", GUEST_ID)).toBe("http://share.test/s/review/g?t=two");
  await guests().remove("review", GUEST_ID);
  expect(seen.map(({ method, path }) => `${method} ${path}`)).toEqual([
    `POST /v1/links/review/guests/${GUEST_ID}/resend`,
    `POST /v1/links/review/guests/${GUEST_ID}/link`,
    `DELETE /v1/links/review/guests/${GUEST_ID}`,
  ]);
});

test("the plan refusal is reworded without naming a plan", async () => {
  refuse = { status: 403, message: "sharing a board with guests requires Team or Business" };
  const refused = await guests()
    .invite("review", { email: "ada@client.example" })
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(Error);
  expect((refused as Error).message).toBe(
    "sharing a board with guests needs a paid plan — upgrade your plan to invite guests",
  );
});

test("any other refusal keeps the cloud's own words", async () => {
  refuse = { status: 403, message: "not your link" };
  const refused = await guests()
    .list("review")
    .catch((error: unknown) => error);
  expect((refused as Error).message).toContain("not your link");
});

test("a rejected credential asks for a sign-in", async () => {
  refuse = { status: 401, message: "token revoked" };
  const refused = await guests()
    .remove("review", GUEST_ID)
    .catch((error: unknown) => error);
  expect((refused as { signInRequired?: string }).signInRequired).toBe("expired");
});
