#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { currentRuntimeTarget } from "./distribution/targets.ts";

if (process.platform === "win32") throw new Error("curl | bash is supported on macOS and Linux");

const repoRoot = dirname(dirname(import.meta.path));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;
const target = currentRuntimeTarget();
const artifacts = join(repoRoot, "release-artifacts");
const artifactName = `velloo-${version}-${target.id}.tar.gz`;
const artifact = join(artifacts, artifactName);
for (const path of [artifact, `${artifact}.sha256`]) {
  if (!existsSync(path)) throw new Error(`missing ${path}; build direct artifacts first`);
}

const root = await mkdtemp(join(tmpdir(), "velloo-direct-smoke-"));
const cleanPath = "/usr/bin:/bin";
const installRoot = join(root, "home");
const binDir = join(root, "bin");

function install(
  downloadBase: string,
  home: string,
  bin: string,
): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(["bash", join(repoRoot, "scripts", "install.sh")], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: cleanPath,
      VELLOO_VERSION: version,
      VELLOO_DOWNLOAD_BASE: `file://${downloadBase}`,
      VELLOO_HOME: home,
      VELLOO_BIN_DIR: bin,
    },
  });
}

try {
  const result = install(artifacts, installRoot, binDir);
  if (!result.success) throw new Error(result.stderr.toString() || "direct installer failed");
  const cli = Bun.spawnSync([join(binDir, "velloo"), "--version"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: cleanPath, VELLOO_DISABLE_UPDATE_CHECK: "1" },
  });
  const output = cli.stdout.toString().trim();
  if (!cli.success || !output.startsWith(`${version} `)) {
    throw new Error(cli.stderr.toString() || `unexpected version output: ${output}`);
  }

  const corrupt = join(root, "corrupt");
  await mkdir(corrupt);
  await symlink(artifact, join(corrupt, artifactName));
  await writeFile(join(corrupt, `${artifactName}.sha256`), `${"0".repeat(64)}  ${artifactName}\n`);
  const rejected = install(corrupt, join(root, "bad-home"), join(root, "bad-bin"));
  if (rejected.success || !rejected.stderr.toString().includes("checksum mismatch")) {
    throw new Error("the direct installer accepted a corrupt checksum");
  }

  console.log(
    `✓ direct-install smoke passed for ${target.id} with no Bun or Node on PATH (${output})`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
