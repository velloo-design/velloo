import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Errors that escape a command's run() must reach the user as one clean
 * `velloo <cmd>: <reason>` line — never Bun's uncaught dump (source excerpt
 * + call stack), which is what citty's fallback produces. The registry's
 * guard (commands/registry.ts) owns this contract.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-cli-err-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A folder that parses as design-folder schema v1 (no schemaVersion field). */
async function writeV1Folder(config = "{}"): Promise<string> {
  const folder = join(tmp, "velloo");
  await mkdir(join(folder, ".design"), { recursive: true });
  await mkdir(join(folder, "theme"), { recursive: true });
  await writeFile(join(folder, ".design", "config.json"), config);
  await writeFile(join(folder, "theme", "default.json"), "{}");
  return folder;
}

async function runPublish(folder: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", cliPath, "publish", folder, "--public"], {
    cwd: tmp,
    stdout: "pipe",
    stderr: "pipe",
    // A token so publish reaches the folder load instead of failing at login.
    env: { ...process.env, HOME: join(tmp, "home"), VELLOO_CLOUD_TOKEN: "test-token", ...env },
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

async function runRun(folder: string) {
  const proc = Bun.spawn(["bun", cliPath, "run", folder, "--background"], {
    cwd: tmp,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, VELLOO_DAEMONS_PATH: join(tmp, "daemons.json") },
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

async function runWithArgs(args: string[]) {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, VELLOO_DAEMONS_PATH: join(tmp, "daemons.json") },
  });
  const exitCode = await proc.exited;
  return { exitCode, stderr: await new Response(proc.stderr).text() };
}

describe("cli error presentation", () => {
  test.each(["run", "mcp", "__daemon"])(
    "%s refuses a non-loopback bind without the explicit unsafe flag",
    async (command) => {
      const { exitCode, stderr } = await runWithArgs([command, tmp, "--host", "0.0.0.0"]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--unsafe-allow-remote");
      expect(stderr).toContain("unauthenticated canvas and MCP endpoints");
    },
  );

  test("a crafted error (schema-version gate) prints one clean line, no stack", async () => {
    const folder = await writeV1Folder();
    const { exitCode, stderr } = await runPublish(folder);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("velloo publish:");
    expect(stderr).toContain("Run `velloo upgrade ");
    // No Bun uncaught dump: no stack frames, no source excerpt, no debug hint.
    expect(stderr).not.toMatch(/at \w+ \(/);
    expect(stderr).not.toContain("throw new Error");
    expect(stderr).not.toContain("VELLOO_DEBUG");
  }, 30_000);

  test("an unexpected error prints the message plus the VELLOO_DEBUG hint", async () => {
    const folder = await writeV1Folder("{ not json");
    const { exitCode, stderr } = await runPublish(folder);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("velloo publish:");
    expect(stderr).toContain("VELLOO_DEBUG=1");
    expect(stderr).not.toMatch(/at \w+ \(/);
  }, 30_000);

  test("VELLOO_DEBUG=1 restores the full error for maintainers", async () => {
    const folder = await writeV1Folder();
    const { exitCode, stderr } = await runPublish(folder, { VELLOO_DEBUG: "1" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("schema version 1");
    expect(stderr).toMatch(/at /);
  }, 30_000);

  test("run refuses an outdated folder up front instead of timing out on the daemon", async () => {
    const folder = await writeV1Folder();
    const { exitCode, stderr } = await runRun(folder);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("velloo run:");
    expect(stderr).toContain("Run `velloo upgrade ");
    expect(stderr).not.toContain("didn't come up");
  }, 30_000);

  test("run quotes a daemon that dies at boot instead of the blind health timeout", async () => {
    // Passes the pre-spawn format gate (v2) but the daemon dies loading the
    // folder — theme/default.json is missing.
    const folder = join(tmp, "velloo-broken");
    await mkdir(join(folder, ".design"), { recursive: true });
    await writeFile(join(folder, ".design", "config.json"), JSON.stringify({ schemaVersion: 3 }));
    const { exitCode, stderr } = await runRun(folder);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("exited during startup");
    expect(stderr).not.toContain("didn't come up");
  }, 30_000);
});
