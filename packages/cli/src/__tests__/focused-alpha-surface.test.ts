import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
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

test("CLI help leads with the focused existing-screen promise and omits ci", async () => {
  const result = await runCli(["--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.out).toContain("redesigning an existing React screen");
  expect(result.out).toContain("running app");
  expect(result.out).toContain("team or external reviewer");
  expect(result.out).not.toMatch(/\|ci(?:\s|$)/);
  expect(result.out).not.toContain("Design CI");
});

test("ci is absent from completion specs", async () => {
  const names = (await commandSpecs()).map((spec) => spec.name);
  expect(names).not.toContain("ci");
});

test("running ci fails as an unknown command", async () => {
  const result = await runCli(["ci"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.out).toContain("Unknown command");
});

test("README states the focused alpha workflow without retired launch claims", async () => {
  const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");
  for (const concept of [
    "redesigning an existing React screen",
    "running app",
    "team workspace",
    "external share link",
    "comment",
  ]) {
    expect(readme.toLowerCase()).toContain(concept.toLowerCase());
  }
  for (const prohibited of ["Velloo design CI", "GitHub App", "pull-request preview"]) {
    expect(readme).not.toContain(prohibited);
  }
});
