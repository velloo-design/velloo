import { afterEach, beforeEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "bun";
import { type CloudPublishedDesign, publishedDesignSubtitle } from "../cloud-published.ts";
import { designFromReference, resolveUnpublishSelection } from "../publish/manage.ts";

const cliPath = resolve(import.meta.dir, "../cli.ts");
let server: Server<undefined>;
let deleted: string[];
let links: Omit<CloudPublishedDesign, "url">[];
let credentialsPath: string;

beforeEach(() => {
  deleted = [];
  credentialsPath = join(
    tmpdir(),
    `velloo-published-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  links = [
    {
      slug: "alpha-review",
      title: "Alpha review",
      visibility: "public",
      passwordProtected: false,
      canManage: true,
      mine: true,
      ownerEmail: "owner@example.com",
      git: { repo: "github.com/velloo/alpha", branch: "main" },
      published: true,
      lastPublishedAt: "2030-01-02T03:04:05.000Z",
    },
    {
      slug: "protected-review",
      title: "Protected review",
      visibility: "private",
      passwordProtected: true,
      canManage: true,
      mine: true,
      ownerEmail: "reviewer@velloo.dev",
      git: null,
      published: true,
      lastPublishedAt: "2030-01-01T00:00:00.000Z",
    },
  ];
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "GET" && pathname === "/v1/links") {
        return Response.json({
          links: links.map((link) => ({ ...link, url: `/s/${link.slug}/` })),
        });
      }
      const matched = pathname.match(/^\/v1\/links\/([^/]+)$/);
      if (req.method === "DELETE" && matched) {
        deleted.push(decodeURIComponent(matched[1] ?? ""));
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(async () => {
  server.stop(true);
  await rm(credentialsPath, { force: true });
});

async function runCli(
  command: "published" | "unpublish",
  args: string[] = [],
  withToken = true,
  baseUrl = `http://localhost:${server.port}`,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      cliPath,
      // Both verbs are `publish` subcommands now; the tests keep naming the
      // behaviour they exercise.
      "publish",
      command === "published" ? "list" : "remove",
      ...args,
      "--url",
      baseUrl,
      ...(withToken ? ["--token", "test-token"] : []),
    ],
    {
      cwd: resolve(import.meta.dir, "../../../.."),
      env: { ...process.env, VELLOO_CREDENTIALS_PATH: credentialsPath },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("published lists human names, access, timestamps, and share URLs", async () => {
  const result = await runCli("published");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Alpha review");
  expect(result.stdout).toContain("public");
  expect(result.stdout).toContain(
    "Published 2030-01-02T03:04:05.000Z · by owner@example.com · repo github.com/velloo/alpha (main)",
  );
  expect(result.stdout).toContain(`http://localhost:${server.port}/s/alpha-review/`);
  expect(result.stdout).toContain("Protected review");
  expect(result.stdout).toContain("password protected");
  expect(result.stdout).toContain(`http://localhost:${server.port}/boards`);
});

test("published handles an empty account and signed-out use", async () => {
  links = [];
  const empty = await runCli("published");
  expect(empty.exitCode).toBe(0);
  expect(empty.stdout).toContain("no published designs");
  expect(empty.stdout).toContain(`http://localhost:${server.port}/boards`);

  const signedOut = await runCli("published", [], false);
  expect(signedOut.exitCode).toBe(1);
  expect(signedOut.stderr).toContain("not logged in");
});

test("noninteractive unpublish requires a full URL and --yes", async () => {
  const missingTarget = await runCli("unpublish", ["--yes"]);
  expect(missingTarget.exitCode).toBe(1);
  expect(missingTarget.stderr).toContain("full share URL");

  const url = `http://localhost:${server.port}/s/alpha-review/`;
  const unconfirmed = await runCli("unpublish", [url]);
  expect(unconfirmed.exitCode).toBe(1);
  expect(unconfirmed.stderr).toContain("without --yes");
  expect(deleted).toEqual([]);
});

test("unpublish revokes the explicitly confirmed published design", async () => {
  const url = `http://localhost:${server.port}/s/alpha-review/`;
  const result = await runCli("unpublish", [url, "--yes"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("removed Alpha review");
  expect(deleted).toEqual(["alpha-review"]);
});

test("unpublish refuses unknown and unauthorized share URLs", async () => {
  const unknown = await runCli("unpublish", ["https://share.example/s/unknown/", "--yes"]);
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("not in your published designs");
  expect(unknown.stderr).toContain(`http://localhost:${server.port}/boards`);

  const first = links[0];
  if (!first) throw new Error("test fixture missing first published design");
  links[0] = { ...first, canManage: false };
  const url = `http://localhost:${server.port}/s/alpha-review/`;
  const unauthorized = await runCli("unpublish", [url, "--yes"]);
  expect(unauthorized.exitCode).toBe(1);
  expect(unauthorized.stderr).toContain("do not have permission");
  expect(deleted).toEqual([]);
});

test("unpublish selection cancellation and internal IDs resolve to no target", () => {
  const designs: CloudPublishedDesign[] = links.map((link) => ({
    ...link,
    url: `https://share.example/s/${link.slug}/`,
  }));
  const first = designs[0];
  if (!first) throw new Error("test fixture missing first published design");
  expect(resolveUnpublishSelection(null, designs)).toBeNull();
  expect(designFromReference("alpha-review", designs)).toBeNull();
  expect(designFromReference(first.url, designs)).toEqual(first);
});

test("published and unpublish report an unreachable cloud cleanly", async () => {
  const unreachable = "http://127.0.0.1:1";
  const listed = await runCli("published", [], true, unreachable);
  expect(listed.exitCode).toBe(1);
  expect(listed.stderr).toContain(`cannot reach ${unreachable}`);

  const removed = await runCli(
    "unpublish",
    ["https://share.example/s/alpha-review/", "--yes"],
    true,
    unreachable,
  );
  expect(removed.exitCode).toBe(1);
  expect(removed.stderr).toContain(`cannot reach ${unreachable}`);
});

test("published metadata uses clear fallbacks", () => {
  expect(publishedDesignSubtitle({ lastPublishedAt: null, ownerEmail: null, git: null })).toBe(
    "Publish time unavailable · publisher unavailable · repository unavailable",
  );
});
