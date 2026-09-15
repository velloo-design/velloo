#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUN_VERSION, currentRuntimeTarget, runtimeTarget } from "./distribution/targets.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;
const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const target = valueAfter("--target")
  ? runtimeTarget(valueAfter("--target") as string)
  : currentRuntimeTarget();
if (target.os === "win32") throw new Error("curl | bash artifacts support macOS and Linux only");

const artifacts = resolve(valueAfter("--out") ?? join(repoRoot, "release-artifacts"));
const commonTarball = resolve(valueAfter("--package") ?? join(repoRoot, `velloo-${version}.tgz`));
const runtimeLicense = join(repoRoot, "BUN-LICENSE.md");
for (const required of [commonTarball, runtimeLicense]) {
  if (!existsSync(required)) throw new Error(`missing ${required}; build the CLI first`);
}

// Baked, not defaulted: a dev-channel archive must keep asking the dev host
// about updates, or the first `velloo upgrade` silently moves the tester onto
// the production release.
const downloadBase = (process.env.VELLOO_DOWNLOAD_BASE ?? "https://get.velloo.design").replace(
  /\/+$/,
  "",
);

const stage = join(artifacts, `direct-${target.id}`);
const app = join(stage, "app");
const cache = join(artifacts, ".npm-cache");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "bin"), { recursive: true });
mkdirSync(join(stage, "runtime"), { recursive: true });

function run(command: string[], cwd = repoRoot): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (!result.success) throw new Error(`\`${command.join(" ")}\` failed (${result.exitCode})`);
}

run([
  "npm",
  "install",
  "--prefix",
  app,
  "--ignore-scripts",
  "--include=optional",
  "--cache",
  cache,
  `--os=${target.os}`,
  `--cpu=${target.cpu}`,
  ...(target.libc ? [`--libc=${target.libc}`] : []),
  commonTarball,
]);

const runtimePackageDir = join(app, "node_modules", ...target.packageName.split("/"));
const runtimeBinary = join(runtimePackageDir, "bin", "bun");
if (!existsSync(runtimeBinary)) {
  throw new Error(
    `npm did not install ${target.packageName}; make sure optional dependencies are enabled`,
  );
}
copyFileSync(runtimeBinary, join(stage, "runtime", "bun"));
copyFileSync(runtimeLicense, join(stage, "BUN-LICENSE.md"));
chmodSync(join(stage, "runtime", "bun"), 0o755);
// The direct launcher uses the copy above, so do not ship a second 64 MB Bun
// inside app/node_modules. Velloo's other platform-specific dependencies stay.
rmSync(join(app, "node_modules", "@oven"), { recursive: true, force: true });

const wrapper = `#!/bin/sh
set -eu
self="$0"
while [ -L "$self" ]; do
  here=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd)
  link=$(readlink "$self")
  case "$link" in /*) self="$link" ;; *) self="$here/$link" ;; esac
done
root=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd)
export VELLOO_INSTALL_METHOD=direct
export VELLOO_DOWNLOAD_BASE="\${VELLOO_DOWNLOAD_BASE:-${downloadBase}}"
export VELLOO_INSTALLER_URL="\${VELLOO_INSTALLER_URL:-$VELLOO_DOWNLOAD_BASE/install.sh}"
exec "$root/runtime/bun" "$root/app/node_modules/velloo/cli.js" "$@"
`;
writeFileSync(join(stage, "bin", "velloo"), wrapper, { mode: 0o755 });
writeFileSync(join(stage, "VERSION"), `${version}\n`);
writeFileSync(
  join(stage, "manifest.json"),
  `${JSON.stringify({ version, target: target.id, bun: BUN_VERSION, downloadBase }, null, 2)}\n`,
);

const artifactName = `velloo-${version}-${target.id}.tar.gz`;
const artifact = join(artifacts, artifactName);
run(["tar", "-czf", artifact, "-C", stage, "."]);
const checksum = createHash("sha256").update(readFileSync(artifact)).digest("hex");
writeFileSync(`${artifact}.sha256`, `${checksum}  ${artifactName}\n`);
console.log(`✓ built ${artifactName} (Bun ${BUN_VERSION})`);
