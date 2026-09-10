/**
 * The default velloo-cloud base URL. Baked at build time via Bun.build `define`
 * (see packages/cli/build.ts): `cli:install` leaves it at localhost; `cli:prod`
 * bakes the hosted URL so the installed binary talks to production by default.
 * A from-source run (`bun run velloo`, no define) falls back to localhost.
 * `VELLOO_CLOUD_URL` (or a command's `--url`) always overrides at runtime.
 */
import { AuthConfigResponseSchema, cloudJson, HealthResponseSchema } from "@velloo/protocol";

declare const __VELLOO_DEFAULT_CLOUD_URL__: string;

const BUILT_DEFAULT =
  // `typeof` is safe when the identifier was never defined (dev/from-source).
  typeof __VELLOO_DEFAULT_CLOUD_URL__ === "string"
    ? __VELLOO_DEFAULT_CLOUD_URL__
    : "http://localhost:7400";

export function defaultCloudUrl(): string {
  return (process.env.VELLOO_CLOUD_URL ?? BUILT_DEFAULT).replace(/\/+$/, "");
}

const CONFIG_TIMEOUT_MS = 5000;

/** Origin of a cloud API URL — the home when the cloud doesn't advertise one. */
function cloudOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/**
 * User-facing velloo-cloud home. The cloud advertises it on `GET /v1/auth/config`
 * (`APP_BASE_URL` there). When that's missing — local, a custom single-host
 * cloud, or an older server — the API origin is the home: those setups serve
 * UI and API together, and a hosted API-only host 301s UI paths to the app.
 */
export async function fetchCloudAppUrl(
  baseUrl: string,
  timeoutMs = CONFIG_TIMEOUT_MS,
): Promise<string> {
  const fallback = cloudOrigin(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${fallback}/v1/auth/config`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fallback;
  }
  if (!res.ok) return fallback;
  const config = await cloudJson(res, AuthConfigResponseSchema, "reading the cloud's config");
  if (!config.ok || config.value.appUrl === undefined) return fallback;
  try {
    const advertised = new URL(config.value.appUrl).origin;
    return isSecureCloudUrl(advertised) ? advertised : fallback;
  } catch {
    return fallback;
  }
}

/** Human-facing published-board management page for this cloud. */
export async function publishedBoardsUrl(baseUrl: string): Promise<string> {
  return `${await fetchCloudAppUrl(baseUrl)}/boards`;
}

/** This cloud's billing page — where a free plan upgrades. */
export async function billingPageUrl(baseUrl: string): Promise<string> {
  return `${await fetchCloudAppUrl(baseUrl)}/billing`;
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

export type CloudHealth =
  | { status: "ok" }
  | { status: "unreachable"; reason: string }
  | { status: "unhealthy"; detail: string };

/**
 * GET `<cloud>/health` before expensive work: a publish that will die at
 * upload time is knowable up front (the cloud's health report already names
 * the dead dependency). Distinguishes unreachable (network error) from
 * unhealthy (the cloud answered `ok: false`). Anything else — a 404 from a
 * cloud without /health, a non-JSON proxy page — passes as ok: the gate must
 * never block a publish that might succeed.
 */
export async function checkCloudHealth(baseUrl: string): Promise<CloudHealth> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    return {
      status: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const health = await cloudJson(res, HealthResponseSchema, "reading the cloud's health");
  if (!health.ok || health.value.ok !== false) return { status: "ok" };
  const down = [
    health.value.db?.ok === false ? "database" : null,
    health.value.blob?.ok === false ? "storage backend" : null,
  ].filter((part): part is string => part !== null);
  const what = down.length > 0 ? down.join(" and ") : "a dependency";
  return {
    status: "unhealthy",
    detail: `the cloud's ${what} is unavailable — publishes and share links are down; try again later.`,
  };
}
