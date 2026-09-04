import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { commandSpecs } from "../completions/spec.ts";

const cliPath = resolve(import.meta.dir, "../cli.ts");
const repoRoot = resolve(import.meta.dir, "../../../..");

async function runCli(args: string[]): Promise<{ exitCode: number; out: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, VELLOO_DISABLE_UPDATE_CHECK: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
  return { exitCode, out };
}

test("ci is absent from completion specs", async () => {
  const names = (await commandSpecs()).map((spec) => spec.name);
  expect(names).not.toContain("ci");
});

test("running ci fails as an unknown command", async () => {
  const result = await runCli(["ci"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.out).toContain("Unknown command");
});
