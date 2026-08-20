import { expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * The `trace` subcommand is a hidden debug surface: registered only when
 * VELLOO_TRACE is set, so it stays out of `velloo --help` and is unrunnable
 * otherwise. Driven as a subprocess since the gate is read at CLI startup.
 */
const cliPath = resolve(import.meta.dir, "../cli.ts");
const cwd = resolve(import.meta.dir, "../../../..");

function envWithout(...drop: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !drop.includes(k)) out[k] = v;
  }
  return out;
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; out: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
  return { exitCode, out };
}

test("trace is absent from --help unless VELLOO_TRACE is set", async () => {
  const off = await runCli(["--help"], envWithout("VELLOO_TRACE"));
  expect(off.out).not.toContain("|trace");

  const on = await runCli(["--help"], { ...envWithout("VELLOO_TRACE"), VELLOO_TRACE: "1" });
  expect(on.out).toContain("|trace");
});

test("running `trace` without VELLOO_TRACE is an unknown command", async () => {
  const r = await runCli(["trace", "--dir", "/tmp/nope"], envWithout("VELLOO_TRACE"));
  expect(r.exitCode).not.toBe(0);
  expect(r.out).toContain("Unknown command");
});
