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
