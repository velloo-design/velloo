#!/usr/bin/env bun
/**
 * Build the prod velloo bundle and publish it to the dogfood download host, so
 * testers update with a single command. Run:
 *
 *   bun run cli:release
 *
 * Builds the self-contained tarball with the prod cloud URL baked in (same as
 * `cli:prod`, but without the local global-install), then `scp`s it plus the
 * installer to the Vultr box's download dir. Caddy serves that dir at
 * https://get.velloo.dev (see velloo-cloud `deploy_vultr.sh`).
 *
 * Env overrides: REMOTE (ssh alias, default vultr-lon), DOWNLOAD_DIR (remote
 * path), VELLOO_BUILD_CLOUD_URL (baked cloud default).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;

const REMOTE = process.env.REMOTE ?? "vultr-lon";
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? "/srv/velloo-cloud/downloads";
const CLOUD_URL = process.env.VELLOO_BUILD_CLOUD_URL ?? "https://api.velloo.ai";

function run(cmd: string[], env?: Record<string, string>): void {
  const proc = Bun.spawnSync(cmd, {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (!proc.success) {
    console.error(`\n✗ \`${cmd.join(" ")}\` failed (exit ${proc.exitCode}).`);
    process.exit(proc.exitCode ?? 1);
  }
}

// 1. Build the self-contained bundle with the prod cloud URL baked in.
run(["bun", join(repoRoot, "packages", "cli", "build.ts")], { VELLOO_BUILD_CLOUD_URL: CLOUD_URL });

// 2. Ensure the remote download dir exists (lets the first release land before
//    the Caddy site is configured).
run(["ssh", REMOTE, `install -d -m 755 ${DOWNLOAD_DIR}`]);

// 3. Upload the tarball (stable + versioned) and the installer.
const tgz = join(repoRoot, `velloo-${version}.tgz`);
const installSh = join(repoRoot, "scripts", "install.sh");
run(["scp", tgz, `${REMOTE}:${DOWNLOAD_DIR}/velloo.tgz`]);
run(["scp", tgz, `${REMOTE}:${DOWNLOAD_DIR}/velloo-${version}.tgz`]);
run(["scp", installSh, `${REMOTE}:${DOWNLOAD_DIR}/install.sh`]);

console.log(
  [
    "",
    `\x1b[32m✓ published velloo ${version}\x1b[0m → ${REMOTE}:${DOWNLOAD_DIR}`,
    `  cloud default baked to \x1b[36m${CLOUD_URL}\x1b[0m`,
    "",
    "  Dogfooders update with:",
    "    \x1b[36mcurl -fsSL https://get.velloo.dev/install.sh | bash\x1b[0m",
    "",
  ].join("\n"),
);
