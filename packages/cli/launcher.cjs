#!/usr/bin/env node
"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");

function linuxLibc() {
  if (process.platform !== "linux") return undefined;
  try {
    const report = process.report?.getReport();
    if (report?.header?.glibcVersionRuntime) return "glibc";
  } catch {}
  try {
    if (/musl/i.test(readFileSync("/usr/bin/ldd", "utf8"))) return "musl";
  } catch {}
  return "musl";
}

function runtimePackage() {
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) return null;
  if (process.platform === "darwin") {
    return arch === "arm64" ? "@oven/bun-darwin-aarch64" : "@oven/bun-darwin-x64-baseline";
  }
  if (process.platform === "win32") {
    return arch === "arm64" ? "@oven/bun-windows-aarch64" : "@oven/bun-windows-x64-baseline";
  }
  if (process.platform === "linux") {
    const musl = linuxLibc() === "musl";
    if (arch === "arm64") {
      return musl ? "@oven/bun-linux-aarch64-musl" : "@oven/bun-linux-aarch64";
    }
    return musl ? "@oven/bun-linux-x64-musl-baseline" : "@oven/bun-linux-x64-baseline";
  }
  return null;
}

function die(message) {
  process.stderr.write(`velloo: ${message}\n`);
  process.exit(1);
}

// Windows cannot reliably replace an executable while that executable is
// running. Handle the bare self-upgrade in the Node launcher before Bun starts;
// folder migrations and `--check` still go through the normal CLI command.
if (process.platform === "win32" && process.argv.length === 3 && process.argv[2] === "upgrade") {
  const adjacentNpm = join(dirname(process.execPath), "npm.cmd");
  const npm = existsSync(adjacentNpm) ? adjacentNpm : "npm.cmd";
  const packageName = process.env.VELLOO_NPM_PACKAGE || "velloo";
  const upgrade = spawnSync(npm, ["install", "-g", `${packageName}@latest`], { stdio: "inherit" });
  if (upgrade.error) die(`could not start npm: ${upgrade.error.message}`);
  if (upgrade.status !== 0) process.exit(upgrade.status == null ? 1 : upgrade.status);
  // npm rewrote this launcher's package in place, so re-entering by the same
  // path runs the NEW velloo — which is the one that must migrate the design
  // folder, since only it knows the format it migrated towards.
  const migrate = spawnSync(process.execPath, [__filename, "upgrade", "--folder-only"], {
    stdio: "inherit",
  });
  process.exit(migrate.status == null ? 1 : migrate.status);
}

const runtimeName = runtimePackage();
if (!runtimeName) {
  die(
    `unsupported platform ${process.platform}/${process.arch}; supported platforms are macOS, Linux, and Windows on x64 or arm64`,
  );
}

let runtimeRoot;
try {
  runtimeRoot = dirname(require.resolve(`${runtimeName}/package.json`));
} catch {
  die(
    `the Bun runtime package ${runtimeName} is missing. Reinstall with \`npm install -g velloo@latest\` and make sure optional dependencies are enabled`,
  );
}

const runtime = join(runtimeRoot, "bin", process.platform === "win32" ? "bun.exe" : "bun");
if (!existsSync(runtime)) die(`the Bun runtime package ${runtimeName} is incomplete`);

const app = join(__dirname, "cli.js");
const child = spawnSync(runtime, [app, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    VELLOO_INSTALL_METHOD: process.env.VELLOO_INSTALL_METHOD || "npm",
    VELLOO_NPM_PACKAGE: process.env.VELLOO_NPM_PACKAGE || "velloo",
    VELLOO_NODE_EXECUTABLE: process.execPath,
    // The install path is how a Homebrew-managed velloo is told apart from an
    // npm one under a Homebrew-installed Node (both live under /opt/homebrew).
    VELLOO_LAUNCHER_PATH: __filename,
  },
});

if (child.error) die(`could not start the bundled Bun runtime: ${child.error.message}`);
process.exit(child.status == null ? 1 : child.status);
