#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { currentRuntimeTarget } from "./distribution/targets.ts";

if (process.platform === "win32") {
  throw new Error("the release smoke test currently runs on the POSIX release runner");
}

const repoRoot = dirname(dirname(import.meta.path));
const version = (
  await import(join(repoRoot, "packages", "cli", "package.json"), {
    with: { type: "json" },
  })
).default.version as string;
const target = currentRuntimeTarget();
const prefix = await mkdtemp(join(tmpdir(), "velloo-package-smoke-"));
const node = Bun.which("node");
if (!node) throw new Error("Node is required to smoke-test the npm launcher");

function run(command: string[], env = process.env): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(command, { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env });
}

try {
  // Installing Bun's tarball alone does not exercise npm's publish-time
  // package.json normalizer. In particular, npm 11+ strips a bin target that
  // starts with `./` while still exiting successfully. Assert the registry-safe
  // spelling before the registry can accept a package without its CLI.
  const publishManifest = JSON.parse(
    readFileSync(join(repoRoot, "packages", "cli", "dist", "package.json"), "utf8"),
  );
  if (publishManifest.bin?.velloo !== "launcher.cjs") {
    throw new Error('publishable package must declare bin.velloo as "launcher.cjs"');
  }
  if (publishManifest.homepage !== "https://velloo.design") {
    throw new Error('publishable package must link its homepage to "https://velloo.design"');
  }

  const install = run([
    "npm",
    "install",
    "-g",
    "--prefix",
    prefix,
    "--cache",
    join(repoRoot, "release-artifacts", ".npm-cache"),
    "--include=optional",
    "--ignore-scripts",
    existsSync(join(repoRoot, "release-artifacts", `velloo-${version}.tgz`))
      ? join(repoRoot, "release-artifacts", `velloo-${version}.tgz`)
      : join(repoRoot, `velloo-${version}.tgz`),
  ]);
  if (!install.success) throw new Error(install.stderr.toString() || "npm install failed");

  const pathWithoutBun = `${dirname(node)}:/usr/bin:/bin`;
  const command = join(prefix, "bin", "velloo");
  const result = run([command, "--version"], { ...process.env, PATH: pathWithoutBun });
  const output = result.stdout.toString().trim();
  // A stable build reports the bare version; dev and local append a build
  // stamp in parentheses (see the channel split in packages/cli/build.ts).
  const reportsVersion = output === version || output.startsWith(`${version} (`);
  if (!result.success || !reportsVersion) {
    throw new Error(result.stderr.toString() || `unexpected version output: ${output}`);
  }
  const bunNotice = join(prefix, "lib", "node_modules", "velloo", "BUN-LICENSE.md");
  if (!existsSync(bunNotice)) throw new Error("packaged Bun license notice is missing");
  const upgradeCheck = run([command, "upgrade", "--check"], {
    ...process.env,
    PATH: pathWithoutBun,
    VELLOO_UPDATE_URL: `data:application/json,${encodeURIComponent(JSON.stringify({ version }))}`,
    VELLOO_DISABLE_UPDATE_CHECK: "1",
  });
  if (!upgradeCheck.success) {
    throw new Error(upgradeCheck.stderr.toString() || "packaged upgrade command failed to load");
  }
  console.log(
    `✓ npm-global smoke passed for ${target.id} with install scripts disabled and no global Bun on PATH (${output})`,
  );
} finally {
  await rm(prefix, { recursive: true, force: true });
}
