import { type CloudErrorCode, isCloudErrorCode } from "./cloud-codes.ts";
import type { ErrorOf } from "./errors.ts";

/**
 * How talking to the cloud can fail.
 *
 * Lives in the protocol package because both sides of velloo need it: the CLI
 * publishes and manages links, the server generates assets and pulls shared
 * comments, and before this they classified the same HTTP outcomes twice under
 * different names.
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
  /**
   * No stored credential, or the cloud rejected the one we have. Every 401
   * classifies here rather than as an `HttpFailure`: "the credential is gone"
   * is a state the product has a next step for, and rendering it as a status
   * line is what made a revoked token read as a server fault.
   */
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
  | { kind: "InsecureCloudUrl"; url: string }
  /**
   * The *caller's* request was wrong before it left — too many reference
   * images, an unreadable file. Not a cloud failure at all, but it shares
   * every call site with one, and splitting it into its own union is what
   * produced a second dialect last time.
   */
  | { kind: "InvalidRequest"; detail: string };

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

export const invalidRequest = (detail: string): ErrorOf<CloudError, "InvalidRequest"> => ({
  kind: "InvalidRequest",
  detail,
});

/**
 * Every `CloudError` kind as data, so a client can recognize one in an
 * untrusted payload without keeping a second hand-written list.
 *
 * `Record<CloudError["kind"], true>` is total over the union, so adding a
 * variant without listing it here is a compile error — the same guarantee
 * `describeCloudError`'s `never` guard gives at the other end.
 */
const CLOUD_ERROR_KINDS: Record<CloudError["kind"], true> = {
  Unreachable: true,
  HttpFailure: true,
  LoggedOut: true,
  ProtocolViolation: true,
  UploadRaceLost: true,
  InsecureCloudUrl: true,
  InvalidRequest: true,
};

/** Narrow an untrusted `kind` from a cloud-backed route's error envelope. */
export function isCloudErrorKind(value: unknown): value is CloudError["kind"] {
  return typeof value === "string" && value in CLOUD_ERROR_KINDS;
}

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

/**
 * What a failing status actually means.
 *
 * Identical to `httpFailure` except for 401, which is the credential being
 * absent, expired or revoked rather than a fault worth reporting as one. Every
 * cloud caller classifies here, so publish, teams, destinations, asset
 * generation and shared comments all reach the same "sign in again" outcome
 * instead of each rendering a bare status line.
 *
 * 403 stays an `HttpFailure`: that caller is authenticated and simply not
 * allowed, and signing in again would not change it.
 */
export function cloudFailure(
  operation: string,
  status: number,
  detail?: string,
  code?: CloudErrorCode,
): ErrorOf<CloudError, "HttpFailure"> | ErrorOf<CloudError, "LoggedOut"> {
  if (status !== 401 && code !== "unauthorized") {
    return httpFailure(operation, status, detail, code);
  }
  // `readFailure` yields "unknown" when the cloud sent no message; the bare
  // sentence is better than quoting that back.
  return loggedOut(
    detail && detail.length > 0 && detail !== "unknown"
      ? `velloo-cloud rejected the stored credential (${detail})`
      : "velloo-cloud rejected the stored credential",
  );
}

/** Convenience for the common `cloudFailure(op, status, ...await readFailure(res))` shape. */
export async function httpFailureFrom(
  operation: string,
  res: Response,
): Promise<ErrorOf<CloudError, "HttpFailure"> | ErrorOf<CloudError, "LoggedOut">> {
  const { detail, code } = await readFailure(res);
  return cloudFailure(operation, res.status, detail, code);
}

/**
 * How many boards a plan may keep published at once, read back out of the
 * cloud's refusal to create another one.
 *
 * Parsing a message is not how a client should learn a rule, but the cloud
 * sends only `forbidden` for every 403 it raises, and this particular one is
 * the single publish failure a user can fix themselves — the difference
 * between "link creation failed (403)" and an offer to take a board down. The
 * shape is pinned by a test on both sides; a cloud that words it differently
 * falls back to the generic sentence rather than lying about a number.
 */
export function boardLimitFrom(error: CloudError): BoardLimit | null {
  if (error.kind !== "HttpFailure" || error.status !== 403) return null;
  const match = /\bthe (\w+) plan is limited to (\d+) active cloud boards\b/.exec(error.detail);
  if (!match?.[1] || !match[2]) return null;
  return { tier: match[1], limit: Number(match[2]) };
}

export interface BoardLimit {
  tier: string;
  limit: number;
}

/**
 * The core sentence for that refusal. Each surface adds its own way out — the
 * CLI a pricing URL, the canvas buttons — so the explanation itself is written
 * once.
 */
export function describeBoardLimit({ tier, limit }: BoardLimit): string {
  return `the ${tier} plan keeps ${limit} board${limit === 1 ? "" : "s"} published at a time — take one down to publish another`;
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
    case "InvalidRequest":
      return error.detail;
    default: {
      const exhaustive: never = error;
      void exhaustive;
      return "the cloud request failed";
    }
  }
}
