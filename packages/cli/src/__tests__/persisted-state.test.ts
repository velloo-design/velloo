import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredential, saveCredential } from "../cloud-credentials.ts";
import { readLock, writeLock } from "../daemon/runtime.ts";

/**
 * State that outlives the process is untrusted input: the daemon lockfile is
 * written by a different process (possibly an older velloo, possibly one that
 * died mid-write), and the credentials file is hand-editable and holds bearer
 * tokens. Both were read with a cast, which reads a corrupt file as a good one
 * — sending a publish at a stale cloud, or a garbage Authorization header.
 */

let tmp: string;
let prevCredentials: string | undefined;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-persisted-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  prevCredentials = process.env.VELLOO_CREDENTIALS_PATH;
  process.env.VELLOO_CREDENTIALS_PATH = join(tmp, "credentials.json");
});

afterEach(async () => {
  if (prevCredentials === undefined) delete process.env.VELLOO_CREDENTIALS_PATH;
  else process.env.VELLOO_CREDENTIALS_PATH = prevCredentials;
  await rm(tmp, { recursive: true, force: true });
});

const lockPath = (root: string) => join(root, ".design", "daemon.json");

const validRecord = (root: string) => ({
  root,
  pid: 4242,
  canvasUrl: "http://127.0.0.1:5173",
  canvasPort: 5173,
  mcpUrl: "http://127.0.0.1:5174/mcp",
  mcpPort: 5174,
  cloudUrl: "https://api.velloo.ai",
  version: "0.1.0",
  startedAt: new Date().toISOString(),
});

describe("daemon lockfile", () => {
  test("round-trips a record it wrote", async () => {
    const rec = validRecord(tmp);
    await writeLock(rec);
    expect(await readLock(tmp)).toEqual(rec);
  });

  test("a truncated write reads as no daemon, not a broken one", async () => {
    await writeFile(lockPath(tmp), '{"root":"/x","pid":42', "utf8");
    expect(await readLock(tmp)).toBeNull();
  });

  test("a record missing required fields is rejected", async () => {
    await writeFile(lockPath(tmp), JSON.stringify({ root: tmp, pid: 42 }), "utf8");
    expect(await readLock(tmp)).toBeNull();
  });

  test("a wrong-typed port is rejected rather than used", async () => {
    // The cast let this through and produced `fetch("http://127.0.0.1:not-a-port")`.
    await writeFile(
      lockPath(tmp),
      JSON.stringify({ ...validRecord(tmp), canvasPort: "5173" }),
      "utf8",
    );
    expect(await readLock(tmp)).toBeNull();
  });

  test("a JSON null reads as no daemon", async () => {
    await writeFile(lockPath(tmp), "null", "utf8");
    expect(await readLock(tmp)).toBeNull();
  });
});

describe("credentials file", () => {
  test("round-trips a saved credential", async () => {
    await saveCredential("https://api.velloo.ai", { token: "t0ken", email: "a@b.c" });
    expect(await loadCredential("https://api.velloo.ai")).toEqual({
      token: "t0ken",
      email: "a@b.c",
    });
  });

  test("a trailing slash resolves to the same cloud", async () => {
    await saveCredential("https://api.velloo.ai", { token: "t0ken", email: "a@b.c" });
    expect(await loadCredential("https://api.velloo.ai/")).not.toBeNull();
  });

  test("a corrupt file reads as signed out rather than throwing", async () => {
    await writeFile(join(tmp, "credentials.json"), "{not json", "utf8");
    expect(await loadCredential("https://api.velloo.ai")).toBeNull();
  });

  test("an entry with a non-string token is rejected", async () => {
    await writeFile(
      join(tmp, "credentials.json"),
      JSON.stringify({
        version: 1,
        clouds: { "https://api.velloo.ai": { token: 42, email: "a" } },
      }),
      "utf8",
    );
    expect(await loadCredential("https://api.velloo.ai")).toBeNull();
  });

  test("a file from a future version is not read as v1", async () => {
    await writeFile(
      join(tmp, "credentials.json"),
      JSON.stringify({
        version: 2,
        clouds: { "https://api.velloo.ai": { token: "t", email: "e" } },
      }),
      "utf8",
    );
    expect(await loadCredential("https://api.velloo.ai")).toBeNull();
  });
});
