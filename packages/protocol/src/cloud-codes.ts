/**
 * The error codes velloo-cloud puts on the wire.
 *
 * Every failing cloud response is `{ error: <code>, message }`, and clients
 * branch on the code: the CLI distinguishes a storage outage from a bad
 * bundle, the server's asset flow keys its "out of credits" path off
 * `insufficient_credits`, and the share viewer's comment panel keys its
 * signed-out state off `sign_in_required`.
 *
 * That made the code a wire contract described nowhere. It was typed `string`
 * on the cloud, so a typo compiled and shipped, and two codes in active use
 * (`generation_failed`, `sign_in_required`) existed only as inline literals,
 * absent from the constructor list a reader would check. Consumers matched
 * string literals with nothing to check them against.
 *
 * Dependency-free on purpose: the cloud's server carries this file into a
 * container that has no velloo checkout (see `scripts/stage-velloo-protocol.ts`
 * over there).
 */

export const CLOUD_ERROR_CODES = [
  "bad_request",
  "unauthorized",
  /** The viewer needs to sign in before commenting on a published link. */
  "sign_in_required",
  "insufficient_credits",
  "forbidden",
  "not_found",
  "conflict",
  "payload_too_large",
  "unsupported_media_type",
  "rate_limited",
  /** An upstream asset-generation provider failed; credits were refunded. */
  "generation_failed",
  /** The cloud's account service answered with a failure. */
  "billing_upstream",
  "unavailable",
  /** Blob-store outage — distinguishable from a genuine 500 bug. */
  "storage_unavailable",
  /** The catch-all the gateway emits for an unhandled throw. */
  "internal",
] as const;

export type CloudErrorCode = (typeof CLOUD_ERROR_CODES)[number];

/** Narrow an untrusted `error` field from a cloud response. */
export function isCloudErrorCode(value: unknown): value is CloudErrorCode {
  return typeof value === "string" && (CLOUD_ERROR_CODES as readonly string[]).includes(value);
}

/** The body shape every failing cloud response carries. */
export interface CloudErrorBody {
  error: CloudErrorCode;
  message: string;
}
