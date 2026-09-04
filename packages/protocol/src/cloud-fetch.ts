import { err, ok, type Result } from "@velloo/result";
import type { z } from "zod";
import {
  type CloudError,
  httpFailureFrom,
  protocolViolation,
  unreachable,
} from "./cloud-errors.ts";

/**
 * The one place a cloud response becomes typed data.
 *
 * `CLAUDE.md` says to use `unknown` at trust boundaries, and the comment
 * client honoured it — but publish, auth, teams and the feedback-token paths
 * all read their responses through `as` casts. A cloud answering `{ slug:
 * null }` produced a `TypeError` deep inside the publish flow instead of the
 * `ProtocolViolation` the CLI already had a variant and a user-facing sentence
 * for. That matters more the moment velloo is open source: third parties will
 * run their own clouds, and "the other end is wrong" has to be a diagnosis,
 * not a crash.
 *
 * Two entry points, because the call sites genuinely differ:
 *
 *  - `cloudFetch` for a plain request/response — one call, one schema.
 *  - `cloudJson` for the flows that must branch on the status themselves
 *    (a publish distinguishes 200 from 201, and a 409 after a transient
 *    failure means something specific), which still parse their body here.
 */

/** Parse a response body against its declared shape. */
export async function cloudJson<T extends z.ZodTypeAny>(
  res: Response,
  schema: T,
  operation: string,
): Promise<Result<z.infer<T>, CloudError>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    return err(
      protocolViolation(
        `${operation}: the cloud's response was not JSON (${error instanceof Error ? error.message : String(error)})`,
      ),
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return err(protocolViolation(`${operation}: the cloud's response did not match the protocol`));
  }
  return ok(parsed.data);
}

export interface CloudFetchOptions extends RequestInit {
  /** Names the failure in messages: "listing teams failed (500): …". */
  operation: string;
  /** Bearer credential; omitted for the unauthenticated endpoints. */
  token?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Request → typed body, with every failure mode as a `CloudError`: the network
 * (`Unreachable`), the status (`HttpFailure`, carrying the cloud's own code
 * when it sent a recognized one), and the shape (`ProtocolViolation`).
 */
export async function cloudFetch<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  opts: CloudFetchOptions,
): Promise<Result<z.infer<T>, CloudError>> {
  const { operation, token, timeoutMs, ...init } = opts;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      ...(timeoutMs !== undefined ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return err(unreachable(error, { url, ...(timedOut ? { timedOut: true } : {}) }));
  }
  if (!res.ok) return err(await httpFailureFrom(operation, res));
  return cloudJson(res, schema, operation);
}
