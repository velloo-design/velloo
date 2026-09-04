#!/usr/bin/env bun
/**
 * Build the velloo bundle and publish it to an environment's download host, so
 * testers update with a single command. Run:
 *
 *   bun run cli:release        # prod → get.velloo.design     (bakes api.velloo.ai)
 *   bun run cli:release:dev    # dev  → get.dev.velloo.design (bakes api.dev.velloo.ai)
 *
 * The download host is velloo-cloud itself serving the env's R2 bucket under
 * the `downloads/` prefix (src/routes/downloads.ts). Uploads go through the R2
 * S3 API using the BLOB_* values from the sibling velloo-cloud checkout's
 * `.env.<env>`.
 *
 * Env overrides: VELLOO_CLOUD_DIR (sibling checkout, default ../velloo-cloud),
 * BLOB_ENDPOINT / BLOB_BUCKET / BLOB_ACCESS_KEY / BLOB_SECRET_KEY (skip the
 * env-file read entirely), VELLOO_BUILD_CLOUD_URL (baked cloud default).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;

const ENVS = {
  prod: { cloudUrl: "https://api.velloo.ai", getHost: "get.velloo.design" },
  dev: { cloudUrl: "https://api.dev.velloo.ai", getHost: "get.dev.velloo.design" },
} as const;
type EnvName = keyof typeof ENVS;

const envArg = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "prod";
const noBuild = process.argv.includes("--no-build");
if (!(envArg in ENVS)) {
  console.error(`✗ unknown environment "${envArg}" — expected ${Object.keys(ENVS).join(" | ")}`);
  process.exit(1);
}
const envName = envArg as EnvName;
const target = ENVS[envName];
const cloudUrl = process.env.VELLOO_BUILD_CLOUD_URL ?? target.cloudUrl;

/** Minimal KEY=VALUE parser for velloo-cloud's .env.<env> files. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const BLOB_KEYS = ["BLOB_ENDPOINT", "BLOB_BUCKET", "BLOB_ACCESS_KEY", "BLOB_SECRET_KEY"] as const;

function blobConfig(): Record<(typeof BLOB_KEYS)[number], string> {
  const fromProcess = BLOB_KEYS.every((k) => process.env[k]);
  let source: Record<string, string | undefined>;
  let where: string;
  if (fromProcess) {
    source = process.env;
    where = "process env";
  } else {
    const cloudDir = resolve(repoRoot, process.env.VELLOO_CLOUD_DIR ?? "../velloo-cloud");
    const envFile = join(cloudDir, `.env.${envName}`);
    if (!existsSync(envFile)) {
      console.error(
        `✗ ${envFile} not found — set VELLOO_CLOUD_DIR to the velloo-cloud checkout, or provide ${BLOB_KEYS.join("/")} in the env.`,
      );
      process.exit(1);
    }
    source = parseEnvFile(envFile);
    where = envFile;
  }
  const missing = BLOB_KEYS.filter((k) => !source[k]);
  if (missing.length > 0) {
    console.error(`✗ missing ${missing.join(", ")} in ${where}`);
    process.exit(1);
  }
  return Object.fromEntries(BLOB_KEYS.map((k) => [k, source[k] as string])) as Record<
    (typeof BLOB_KEYS)[number],
    string
  >;
}

const blob = blobConfig();

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

// 1. Build the npm package, direct archives, checksums, and the version-baked
//    installer from one source version.
if (!noBuild) {
  run(["bun", join(repoRoot, "scripts", "build-release-artifacts.ts")], {
    VELLOO_BUILD_CLOUD_URL: cloudUrl,
  });
}

// 2. Upload the tarball (stable + versioned) and the installer to the env's
//    bucket under downloads/ — the app serves them on GET_HOST, deriving
//    content-type from the filename, so plain puts suffice.
const s3 = new Bun.S3Client({
  endpoint: blob.BLOB_ENDPOINT,
  bucket: blob.BLOB_BUCKET,
  accessKeyId: blob.BLOB_ACCESS_KEY,
  secretAccessKey: blob.BLOB_SECRET_KEY,
});

const artifactDir = join(repoRoot, "release-artifacts");
const files = readdirSync(artifactDir).filter(
  (name) =>
    !name.startsWith(".") &&
    !name.startsWith("direct-") &&
    (name === "install.sh" ||
      name === "SHA256SUMS" ||
      name.endsWith(".tgz") ||
      name.endsWith(".tar.gz") ||
      name.endsWith(".sha256")),
);

console.log(`\x1b[36m▸\x1b[0m uploading to ${blob.BLOB_BUCKET}/downloads/ (${target.getHost})…`);
for (const name of files) {
  if (name === "install.sh") {
    const installer = readFileSync(join(artifactDir, name), "utf8").replaceAll(
      "get.velloo.design",
      target.getHost,
    );
    await s3.write(`downloads/${name}`, installer);
  } else {
    await s3.write(`downloads/${name}`, Bun.file(join(artifactDir, name)));
  }
}
await s3.write("downloads/velloo.tgz", Bun.file(join(artifactDir, `velloo-${version}.tgz`)));

console.log(
  [
    "",
    `\x1b[32m✓ published velloo ${version}\x1b[0m → ${envName} (${blob.BLOB_BUCKET}/downloads/)`,
    `  cloud default baked to \x1b[36m${cloudUrl}\x1b[0m`,
    "",
    "  Dogfooders update with:",
    `    \x1b[36mcurl -fsSL https://${target.getHost}/install.sh | bash\x1b[0m`,
    "",
  ].join("\n"),
);
