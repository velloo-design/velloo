import type { ErrorOf } from "@velloo/protocol";
import { type CloudErrorCode, isCloudErrorCode } from "@velloo/protocol/cloud-codes";

/**
 * How talking to the cloud can fail.
 *
 * CLI errors *are* the product — they are the only thing a user sees when a
 * publish does not work — so they get the same treatment as the server's
 * mutations: a kinded union, one renderer, no prose scattered across call
 * sites. Before this the cloud modules threw `new Error(template string)` from
 * a dozen places, which meant nothing enumerated the failure modes, nothing
 * guaranteed each one carried an actionable next step, and a caller that
 * wanted to treat "logged out" differently from "the cloud is down" had to
 * match on message text.
 *
 * Each constructor returns its own variant (see `ErrorOf`), so a function that
 * can only fail two ways says so.
 */
export type CloudError =
  /**
   * The cloud could not be reached at all: DNS, connection refused, timeout.
   * `url` names the target — "cannot reach http://…" is what tells a user
   * whether they are pointed at the wrong cloud or simply offline.
   */
  | { kind: "Unreachable"; detail: string; url?: string; timedOut?: boolean }
  /**
   * The cloud answered, but with a failure status. `code` is its own
   * machine-readable reason when it sent a recognized one, so a caller can
   * branch on the cause rather than parsing the message.
   */
  | {
      kind: "HttpFailure";
      operation: string;
      status: number;
      detail: string;
      code?: CloudErrorCode;
    }
  /** No stored credential, or the cloud rejected the one we have. */
  | { kind: "LoggedOut"; detail?: string }
  /** The cloud did something the protocol forbids — always a bug, ours or theirs. */
  | { kind: "ProtocolViolation"; detail: string }
  /**
   * An upload whose confirmation was lost, where the retry found the slot
   * already advanced. Distinct from a plain failure because the publish may
   * actually have succeeded — the advice is "look before retrying".
   */
  | { kind: "UploadRaceLost" }
  /** Refusing to send a bearer token over a channel that isn't safe. */
  | { kind: "InsecureCloudUrl"; url: string };

export const unreachable = (
  error: unknown,
  opts: { url?: string; timedOut?: boolean } = {},
): ErrorOf<CloudError, "Unreachable"> => ({
  kind: "Unreachable",
  detail: error instanceof Error ? error.message : String(error),
  ...(opts.url !== undefined ? { url: opts.url } : {}),
  ...(opts.timedOut ? { timedOut: true } : {}),
});

export const httpFailure = (
  operation: string,
  status: number,
  detail?: string,
  code?: CloudErrorCode,
): ErrorOf<CloudError, "HttpFailure"> => ({
  kind: "HttpFailure",
  operation,
  status,
  detail: detail && detail.length > 0 ? detail : "unknown",
  ...(code !== undefined ? { code } : {}),
});

export const loggedOut = (detail?: string): ErrorOf<CloudError, "LoggedOut"> =>
  detail === undefined ? { kind: "LoggedOut" } : { kind: "LoggedOut", detail };

export const protocolViolation = (detail: string): ErrorOf<CloudError, "ProtocolViolation"> => ({
  kind: "ProtocolViolation",
  detail,
});

export const uploadRaceLost = (): ErrorOf<CloudError, "UploadRaceLost"> => ({
  kind: "UploadRaceLost",
});

export const insecureCloudUrl = (url: string): ErrorOf<CloudError, "InsecureCloudUrl"> => ({
  kind: "InsecureCloudUrl",
  url,
});

/**
 * Read a failure body without trusting its shape. The cloud sends
 * `{ error, message }`; an unrecognized `error` is dropped rather than
 * widening the union to `string`.
 */
export async function readFailure(
  res: Response,
): Promise<{ detail: string; code?: CloudErrorCode }> {
  const body: unknown = await res.json().catch(() => undefined);
  if (!body || typeof body !== "object") return { detail: "unknown" };
  const { message, error } = body as { message?: unknown; error?: unknown };
  const detail = typeof message === "string" && message.length > 0 ? message : "unknown";
  return isCloudErrorCode(error) ? { detail, code: error } : { detail };
}

/** Convenience for the common `httpFailure(op, status, ...await readFailure(res))` shape. */
export async function httpFailureFrom(
  operation: string,
  res: Response,
): Promise<ErrorOf<CloudError, "HttpFailure">> {
  const { detail, code } = await readFailure(res);
  return httpFailure(operation, res.status, detail, code);
}

/**
 * A 5xx is the cloud's trouble, not the user's bundle — say so rather than
 * leaving a bare "internal error".
 */
const serverTrouble = (status: number): string =>
  status >= 500 ? " — the cloud is having trouble; check its status or try again later" : "";

/**
 * One sentence per failure, ending wherever possible in what to do next.
 * The `never` guard makes a new variant a compile error here rather than a
 * silent fallthrough to something vague.
 */
export function describeCloudError(error: CloudError): string {
  switch (error.kind) {
    case "Unreachable": {
      const target = error.url ? `cannot reach ${error.url}` : "cannot reach the cloud";
      return error.timedOut
        ? `${target} — timed out (${error.detail}); check your connection and try again`
        : `${target} (${error.detail}) — check your connection and try again`;
    }
    case "HttpFailure":
      return `${error.operation} failed (${error.status}): ${error.detail}${serverTrouble(error.status)}`;
    case "LoggedOut":
      return error.detail
        ? `${error.detail} — run \`velloo login\``
        : "you are signed out — run `velloo login`";
    case "ProtocolViolation":
      return `${error.detail} — this is a bug; please report it`;
    case "UploadRaceLost":
      return (
        "upload confirmation was lost and the retry found the publish slot changed — " +
        "the publish may have succeeded; check your published boards before retrying"
      );
    case "InsecureCloudUrl":
      return `refusing to send credentials to ${error.url} over an insecure connection`;
    default: {
      const exhaustive: never = error;
      void exhaustive;
      return "the cloud request failed";
    }
  }
}
