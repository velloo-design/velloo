#!/usr/bin/env bun
/**
 * Build the velloo bundle and install it globally — for local dogfooding of the
 * exact artifact a tester gets (not the from-source `bun run velloo`). Run:
 *
 *   bun run cli:install
 *
 * Rebuilds the canvas + bundles the CLI + packs the tarball, then
 * `bun install -g` it, replacing any previously installed version.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, { cwd: repoRoot, stdout: "inherit", stderr: "inherit" });
  if (!proc.success) {
    console.error(`\n✗ \`${cmd.join(" ")}\` failed (exit ${proc.exitCode}).`);
    process.exit(proc.exitCode ?? 1);
  }
}

// 1. Build the self-contained bundle (canvas + cli + skills + tarball).
run(["bun", join(repoRoot, "packages", "cli", "build.ts")]);

// 2. Drop any prior global install first. `bun add -g <tarball-path>` appends a
//    duplicate `velloo` dependency to the global package.json each run (keyed by
//    path, not name), so reinstalls accumulate noisy duplicate-key warnings.
//    Best-effort — a missing prior install is fine.
Bun.spawnSync(["bun", "remove", "-g", "velloo"], {
  cwd: repoRoot,
  stdout: "ignore",
  stderr: "ignore",
});

// 3. Install the freshly packed tarball globally.
const tgz = join(repoRoot, `velloo-${version}.tgz`);
run(["bun", "install", "-g", tgz]);

// 4. Report where it landed + a PATH hint.
const binDir = Bun.spawnSync(["bun", "pm", "bin", "-g"], { cwd: repoRoot })
  .stdout.toString()
  .trim();
console.log(`\n\x1b[32m✓ velloo ${version} installed globally\x1b[0m → ${join(binDir, "velloo")}`);
console.log(`  Make sure ${binDir} is on your PATH, then run:  velloo --help`);
