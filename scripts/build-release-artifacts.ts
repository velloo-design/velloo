#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderInstaller } from "./distribution/downloads.ts";
import { BUN_VERSION, RUNTIME_TARGETS } from "./distribution/targets.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(repoRoot, "release-artifacts");
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;
if (process.versions.bun !== BUN_VERSION) {
  throw new Error(`release builds require Bun ${BUN_VERSION}; running ${process.versions.bun}`);
}

function run(command: string[], env?: Record<string, string>): void {
  const result = Bun.spawnSync(command, {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (!result.success) throw new Error(`\`${command.join(" ")}\` failed (${result.exitCode})`);
}

rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });

// Releases are cut for a named channel; the artifacts then check that
// channel's host for updates rather than the production one.
const channel = process.env.VELLOO_BUILD_CHANNEL ?? "stable";
const downloadBase =
  process.env.VELLOO_DOWNLOAD_BASE ??
  (channel === "dev" ? "https://get.dev.velloo.design" : "https://get.velloo.design");

run(["bun", "packages/cli/build.ts"], { VELLOO_BUILD_CHANNEL: channel });
copyFileSync(join(repoRoot, `velloo-${version}.tgz`), join(artifacts, `velloo-${version}.tgz`));

for (const target of RUNTIME_TARGETS.filter((candidate) => candidate.os !== "win32")) {
  run(["bun", "scripts/build-direct-artifact.ts", "--target", target.id], {
    VELLOO_DOWNLOAD_BASE: downloadBase,
  });
}

writeFileSync(join(artifacts, "install.sh"), renderInstaller(version, downloadBase), {
  mode: 0o755,
});

// The version endpoint every non-npm installation polls. npm installs on the
// stable channel ask the registry instead — that is the artifact npm would
// actually resolve — but a dev release never reaches npm, and the direct
// archives are cut independently of the publish, so they need their own answer.
writeFileSync(
  join(artifacts, "latest.json"),
  `${JSON.stringify({ version, channel, builtAt: Date.now() }, null, 2)}\n`,
);

const files = readdirSync(artifacts)
  .filter((name) => !name.startsWith(".") && name !== "SHA256SUMS")
  .filter((name) => !name.startsWith("direct-"));
const sums = files
  .filter((name) => !name.endsWith(".sha256"))
  .map((name) => {
    const hash = createHash("sha256")
      .update(readFileSync(join(artifacts, name)))
      .digest("hex");
    return `${hash}  ${name}`;
  });
writeFileSync(join(artifacts, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`✓ built ${files.length} release files for Velloo ${version}`);
