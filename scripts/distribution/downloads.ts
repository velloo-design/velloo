import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DOWNLOAD_HOSTS = { prod: "get.velloo.design", dev: "get.dev.velloo.design" } as const;
export type DownloadEnvironment = keyof typeof DOWNLOAD_HOSTS;

export function downloadEnvironment(value: string | undefined): DownloadEnvironment {
  if (value && value in DOWNLOAD_HOSTS) return value as DownloadEnvironment;
  throw new Error(
    `unknown environment "${value ?? ""}" — expected ${Object.keys(DOWNLOAD_HOSTS).join(" | ")}`,
  );
}

const installerTemplate = join(dirname(dirname(fileURLToPath(import.meta.url))), "install.sh");

/** `scripts/install.sh` with the version and download base it installs from baked in. */
export function renderInstaller(version: string, downloadBase: string): string {
  return readFileSync(installerTemplate, "utf8")
    .replaceAll("@VELLOO_VERSION@", version)
    .replaceAll("@VELLOO_DOWNLOAD_BASE@", downloadBase);
}

/** The usage line in the installer's header names the host it is served from. */
export function installerForHost(installer: string, host: string): string {
  return installer.replaceAll("get.velloo.design", host);
}

const BLOB_KEYS = ["BLOB_ENDPOINT", "BLOB_BUCKET", "BLOB_ACCESS_KEY", "BLOB_SECRET_KEY"] as const;

/**
 * The bucket behind a download host. The host serves its `downloads/` prefix
 * and derives content-type from the filename, so plain puts suffice. The
 * credentials exist only as GitHub environment secrets.
 */
export function downloadBucket(): { client: Bun.S3Client; bucket: string } {
  const missing = BLOB_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(", ")} — this runs in CI with the environment's secrets.`,
    );
  }
  const env = (key: (typeof BLOB_KEYS)[number]) => process.env[key] as string;
  return {
    bucket: env("BLOB_BUCKET"),
    client: new Bun.S3Client({
      endpoint: env("BLOB_ENDPOINT"),
      bucket: env("BLOB_BUCKET"),
      accessKeyId: env("BLOB_ACCESS_KEY"),
      secretAccessKey: env("BLOB_SECRET_KEY"),
    }),
  };
}
