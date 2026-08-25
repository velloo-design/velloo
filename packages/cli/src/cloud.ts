/**
 * The default velloo-cloud base URL. Baked at build time via Bun.build `define`
 * (see packages/cli/build.ts): `cli:install` leaves it at localhost; `cli:prod`
 * bakes the hosted URL so the installed binary talks to production by default.
 * A from-source run (`bun run velloo`, no define) falls back to localhost.
 * `VELLOO_CLOUD_URL` (or a command's `--url`) always overrides at runtime.
 */
declare const __VELLOO_DEFAULT_CLOUD_URL__: string;

const BUILT_DEFAULT =
  // `typeof` is safe when the identifier was never defined (dev/from-source).
  typeof __VELLOO_DEFAULT_CLOUD_URL__ === "string"
    ? __VELLOO_DEFAULT_CLOUD_URL__
    : "http://localhost:7400";

export function defaultCloudUrl(): string {
  return (process.env.VELLOO_CLOUD_URL ?? BUILT_DEFAULT).replace(/\/+$/, "");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * A cloud URL is safe to send the `vlk_` bearer token to only over HTTPS, or
 * over plain HTTP to loopback (local dev). Any other scheme/host would leak the
 * credential in cleartext (or to a MITM after an http:// downgrade).
 */
export function isSecureCloudUrl(cloudUrl: string): boolean {
  try {
    const u = new URL(cloudUrl);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/** Throw if `cloudUrl` isn't safe to send a token to (see isSecureCloudUrl). */
export function assertSecureCloudUrl(cloudUrl: string): void {
  if (!isSecureCloudUrl(cloudUrl)) {
    throw new Error(
      `refusing to send credentials to a non-HTTPS cloud URL: ${cloudUrl} (use https:// or a loopback host)`,
    );
  }
}
