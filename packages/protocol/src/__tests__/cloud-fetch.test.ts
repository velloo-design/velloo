import { expect, test } from "bun:test";
import { z } from "zod";
import { LinkResponseSchema, TeamsResponseSchema } from "../cloud-api.ts";
import { describeCloudError } from "../cloud-errors.ts";
import { cloudFetch, cloudJson } from "../cloud-fetch.ts";

/**
 * The boundary these tests defend: a cloud that answers the wrong thing must
 * produce a `CloudError` the caller can render, never an exception several
 * frames later. Before `cloudFetch`, every one of these responses was read
 * through an `as` cast — `{ slug: null }` type-checked, then threw a
 * `TypeError` deep inside the publish flow.
 */

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a response of the wrong shape is a ProtocolViolation, not a throw", async () => {
  const result = await cloudJson(respond({ slug: null }), LinkResponseSchema, "link creation");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("ProtocolViolation");
  expect(describeCloudError(result.error)).toContain("link creation");
  expect(describeCloudError(result.error)).toContain("please report it");
});

test("a body that isn't JSON at all is a ProtocolViolation too", async () => {
  const html = new Response("<html>proxy error</html>", { status: 200 });
  const result = await cloudJson(html, LinkResponseSchema, "link creation");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe("ProtocolViolation");
});

test("unknown keys are kept out of the way rather than rejected", async () => {
  const result = await cloudJson(
    respond({ slug: "abc", visibility: "public", futureField: 1 }),
    LinkResponseSchema,
    "link creation",
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toEqual({ slug: "abc", visibility: "public" });
});

test("cloudFetch reports an unreachable cloud with the url it tried", async () => {
  const result = await cloudFetch("http://127.0.0.1:1/v1/teams/mine", TeamsResponseSchema, {
    operation: "listing teams",
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("Unreachable");
  expect(describeCloudError(result.error)).toContain("127.0.0.1:1");
});

test("cloudFetch carries the cloud's own error code through the failure", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json(
        { error: "storage_unavailable", message: "the store is down" },
        { status: 503 },
      ),
  });
  try {
    const result = await cloudFetch(
      `http://localhost:${server.port}/v1/teams/mine`,
      TeamsResponseSchema,
      { operation: "listing teams" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "HttpFailure",
      status: 503,
      code: "storage_unavailable",
      detail: "the store is down",
    });
    // A 5xx says whose problem it is.
    expect(describeCloudError(result.error)).toContain("the cloud is having trouble");
  } finally {
    server.stop(true);
  }
});

test("a schema with a transform still reports its own failure as a violation", async () => {
  const schema = z.object({ n: z.number() }).transform((v) => v.n * 2);
  const result = await cloudJson(respond({ n: "eight" }), schema, "doubling");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe("ProtocolViolation");
});

/**
 * A 401 is the one status that is not a fault to report. Rendering it as
 * `HttpFailure` is what produced "listing publish destinations failed (401):
 * invalid or revoked token" in the canvas — a sentence that names no way out
 * of the one state the user could have fixed in a click.
 */
test("a 401 is a LoggedOut, keeping the cloud's reason and naming the way back", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json(
        { error: "unauthorized", message: "invalid or revoked token" },
        { status: 401 },
      ),
  });
  try {
    const result = await cloudFetch(
      `http://localhost:${server.port}/v1/publish-destinations`,
      TeamsResponseSchema,
      { operation: "listing publish destinations", token: "vlk_stale" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("LoggedOut");
    const sentence = describeCloudError(result.error);
    expect(sentence).toContain("invalid or revoked token");
    expect(sentence).toContain("velloo login");
    expect(sentence).not.toContain("401");
  } finally {
    server.stop(true);
  }
});

/** 403 is authenticated-but-not-allowed: signing in again would not help. */
test("a 403 stays an HttpFailure", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ error: "forbidden", message: "not your team" }, { status: 403 }),
  });
  try {
    const result = await cloudFetch(
      `http://localhost:${server.port}/v1/teams/mine`,
      TeamsResponseSchema,
      {
        operation: "listing teams",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "HttpFailure", status: 403 });
  } finally {
    server.stop(true);
  }
});
