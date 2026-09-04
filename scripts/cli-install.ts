#!/usr/bin/env bun
/**
 * Build the velloo bundle and install it globally — for local dogfooding of the
 * exact artifact a tester gets (not the from-source `bun run velloo`). Run:
 *
 *   bun run cli:install
 *
 * Rebuilds the canvas + bundles the CLI, then installs the tarball with npm
 * like a real end user. npm selects the matching official Bun runtime package.
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

// 2. Install the freshly packed package globally. Its exact @oven/bun-* optional
// dependency supplies the current platform binary without an install script.
const tgz = join(repoRoot, `velloo-${version}.tgz`);
run([
  "npm",
  "install",
  "-g",
  "--include=optional",
  "--cache",
  join(repoRoot, "release-artifacts", ".npm-cache"),
  tgz,
]);

// 3. Report where it landed + a PATH hint.
const npmPrefix = Bun.spawnSync(["npm", "prefix", "-g"], { cwd: repoRoot })
  .stdout.toString()
  .trim();
const binDir = process.platform === "win32" ? npmPrefix : join(npmPrefix, "bin");
console.log(`\n\x1b[32m✓ velloo ${version} installed globally\x1b[0m → ${join(binDir, "velloo")}`);
const prodUrl = process.env.VELLOO_BUILD_CLOUD_URL;
if (prodUrl) {
  console.log(
    `  Cloud default baked to \x1b[36m${prodUrl}\x1b[0m — run \`bun run cli:install\` to revert to local.`,
  );
}
console.log(`  Make sure ${binDir} is on your PATH, then run:  velloo --help`);
