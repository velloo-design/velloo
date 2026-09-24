import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanvasAuth } from "@velloo/server";
import { saveCredential } from "../cloud-credentials.ts";
import { createCanvasPublish } from "../daemon/canvas-publish.ts";

/**
 * The canvas asks up front whether this account can publish at all, so a
 * reviewer reads why (and what to do) when the dialog opens — not after a
 * capture and upload the cloud refuses.
 */

let teamsReply: Record<string, unknown>[] | null = [];
const cloud = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname === "/v1/teams/mine") {
      return teamsReply
        ? Response.json({ teams: teamsReply })
        : new Response("down", { status: 503 });
    }
    return new Response("not found", { status: 404 });
  },
});
const cloudUrl = `http://127.0.0.1:${cloud.port}`;
const auth = { status: async () => ({ verified: true }) } as unknown as CanvasAuth;

let dir: string;
const previous = process.env.VELLOO_CREDENTIALS_PATH;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-blocked-"));
  process.env.VELLOO_CREDENTIALS_PATH = join(dir, "credentials.json");
  await saveCredential(cloudUrl, { token: "tok", email: "rae@example.com" });
});
afterEach(() => {
  teamsReply = [];
});
afterAll(async () => {
  cloud.stop(true);
  if (previous === undefined) delete process.env.VELLOO_CREDENTIALS_PATH;
  else process.env.VELLOO_CREDENTIALS_PATH = previous;
  await rm(dir, { recursive: true, force: true });
});

const blocked = () => createCanvasPublish(cloudUrl, auth).blocked?.();

test("a reviewer is told why, and how to get publishing rights", async () => {
  teamsReply = [{ id: "t1", name: "Design", role: "reviewer", canPublish: false }];
  expect(await blocked()).toBe(
    "reviewers can view and comment on boards, but not publish them — to publish, ask an owner or admin to make you a member",
  );
});

test("a member of a lapsed organization is told the owner publishes", async () => {
  teamsReply = [{ id: "t1", name: "Design", role: "member", canPublish: false }];
  expect(await blocked()).toContain("only the organization owner publishes");
});

test("anyone who can publish somewhere isn't blocked", async () => {
  teamsReply = [
    { id: "t1", name: "Design", role: "member", canPublish: true },
    { id: "t2", name: "Brand", role: "reviewer", canPublish: false },
  ];
  expect(await blocked()).toBeNull();
});

test("a personal account, or a cloud that can't be asked, leaves it to the publish", async () => {
  expect(await blocked()).toBeNull();
  teamsReply = null;
  expect(await blocked()).toBeNull();
});
