#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

run(["bun", "packages/cli/build.ts"]);
copyFileSync(join(repoRoot, `velloo-${version}.tgz`), join(artifacts, `velloo-${version}.tgz`));

for (const target of RUNTIME_TARGETS.filter((candidate) => candidate.os !== "win32")) {
  run(["bun", "scripts/build-direct-artifact.ts", "--target", target.id]);
}

const installer = readFileSync(join(repoRoot, "scripts", "install.sh"), "utf8").replaceAll(
  "@VELLOO_VERSION@",
  version,
);
writeFileSync(join(artifacts, "install.sh"), installer, { mode: 0o755 });

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
