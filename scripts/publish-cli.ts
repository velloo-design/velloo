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
import {
  DOWNLOAD_HOSTS,
  downloadBucket,
  downloadEnvironment,
  installerForHost,
} from "./distribution/downloads.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"))
  .version as string;

let host: string;
let s3: Bun.S3Client;
let bucket: string;
try {
  host = DOWNLOAD_HOSTS[downloadEnvironment(process.argv[2])];
  ({ client: s3, bucket } = downloadBucket());
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

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

console.log(`\x1b[36m▸\x1b[0m mirroring velloo ${version} to ${bucket}/downloads/ (${host})…`);
for (const name of files) {
  if (name === "install.sh") {
    const installer = installerForHost(readFileSync(join(artifactDir, name), "utf8"), host);
    await s3.write(`downloads/${name}`, installer);
  } else {
    await s3.write(`downloads/${name}`, Bun.file(join(artifactDir, name)));
  }
}
await s3.write("downloads/velloo.tgz", Bun.file(join(artifactDir, `velloo-${version}.tgz`)));
console.log(`\x1b[32m✓ mirrored velloo ${version}\x1b[0m → ${host}`);
