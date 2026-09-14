#!/usr/bin/env bun
/**
 * Mirror a built release into an environment's download bucket, under the
 * `downloads/` prefix the download host serves:
 *
 *   bun scripts/publish-cli.ts prod   # → get.velloo.design
 *   bun scripts/publish-cli.ts dev    # → get.dev.velloo.design
 *
 * GitHub releases are where the artifacts live; this runs only while the
 * download host still serves them from its own bucket, and only in CI
 * (release.yml, dogfood.yml) after `build-release-artifacts.ts`, with
 * BLOB_ENDPOINT / BLOB_BUCKET / BLOB_ACCESS_KEY / BLOB_SECRET_KEY from the
 * GitHub environment.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;

const HOSTS = { prod: "get.velloo.design", dev: "get.dev.velloo.design" } as const;

const envArg = process.argv[2] ?? "";
if (!(envArg in HOSTS)) {
  console.error(`✗ unknown environment "${envArg}" — expected ${Object.keys(HOSTS).join(" | ")}`);
  process.exit(1);
}
const host = HOSTS[envArg as keyof typeof HOSTS];

const BLOB_KEYS = ["BLOB_ENDPOINT", "BLOB_BUCKET", "BLOB_ACCESS_KEY", "BLOB_SECRET_KEY"] as const;
const missing = BLOB_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `✗ missing ${missing.join(", ")} — this mirror runs in CI with the environment's secrets.`,
  );
  process.exit(1);
}
const env = (key: (typeof BLOB_KEYS)[number]) => process.env[key] as string;

// The download host derives content-type from the filename, so plain puts suffice.
const s3 = new Bun.S3Client({
  endpoint: env("BLOB_ENDPOINT"),
  bucket: env("BLOB_BUCKET"),
  accessKeyId: env("BLOB_ACCESS_KEY"),
  secretAccessKey: env("BLOB_SECRET_KEY"),
});

const artifactDir = join(repoRoot, "release-artifacts");
const files = readdirSync(artifactDir).filter(
  (name) =>
    !name.startsWith(".") &&
    !name.startsWith("direct-") &&
    (name === "install.sh" ||
      name === "latest.json" ||
      name === "SHA256SUMS" ||
      name.endsWith(".tgz") ||
      name.endsWith(".tar.gz") ||
      name.endsWith(".sha256")),
);

console.log(
  `\x1b[36m▸\x1b[0m mirroring velloo ${version} to ${env("BLOB_BUCKET")}/downloads/ (${host})…`,
);
for (const name of files) {
  if (name === "install.sh") {
    const installer = readFileSync(join(artifactDir, name), "utf8").replaceAll(
      "get.velloo.design",
      host,
    );
    await s3.write(`downloads/${name}`, installer);
  } else {
    await s3.write(`downloads/${name}`, Bun.file(join(artifactDir, name)));
  }
}
await s3.write("downloads/velloo.tgz", Bun.file(join(artifactDir, `velloo-${version}.tgz`)));
console.log(`\x1b[32m✓ mirrored velloo ${version}\x1b[0m → ${host}`);
