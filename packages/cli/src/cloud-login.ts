import {
  AccountResponseSchema,
  AuthConfigResponseSchema,
  CliTokenResponseSchema,
  type CloudAccount,
  DeviceCodeResponseSchema,
  type DeviceLoginResult,
  DeviceTokenResponseSchema,
  readFailure,
} from "@velloo/protocol";
import { assertSecureCloudUrl, isSecureCloudUrl } from "./cloud.ts";
import { openUrl } from "./open-url.ts";

export type { CloudAccount, DeviceLoginResult } from "@velloo/protocol";

/**
 * The cloud's verdict on a stored token. `rejected` means revoked or expired —
 * a re-sign-in fixes it; `unreachable` means we couldn't ask, so callers keep
 * trusting the local credential rather than pretending it's dead.
 */
export type AccountLookup =
  | { status: "ok"; account: CloudAccount }
  | { status: "rejected" }
  | { status: "unreachable" };

/**
 * Ask `cloudUrl` who a token belongs to (`GET /v1/me`) — email plus the
 * display name and plan tier the canvas account panel shows. `timeoutMs` caps
 * the wait; status-style callers want a snappier check than the default.
 */
export async function fetchAccount(
  cloudUrl: string,
  token: string,
  timeoutMs = 8000,
): Promise<AccountLookup> {
  // Never transmit the token over an insecure URL; treat as unverifiable.
  if (!isSecureCloudUrl(cloudUrl)) return { status: "unreachable" };
  const res = await fetch(`${cloudUrl}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!res) return { status: "unreachable" };
  // Only the cloud saying "not you" is a rejection; a 5xx or a garbled body is
  // the cloud's problem and must not log the user out of the canvas.
  if (res.status === 401 || res.status === 403) return { status: "rejected" };
  if (!res.ok) return { status: "unreachable" };
  const parsed = AccountResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { status: "unreachable" };
  const body = parsed.data;
  return {
    status: "ok",
    account: {
      email: body.email,
      ...(body.name ? { name: body.name } : {}),
      ...(body.tier ? { tier: body.tier } : {}),
      // null is meaningful (the cloud couldn't price it); undefined means an
      // older cloud that doesn't report a balance, so only the latter is dropped.
      ...(body.creditMicros !== undefined ? { creditMicros: body.creditMicros } : {}),
    },
  };
}

/**
 * Whether a stored CLI token is still accepted by `cloudUrl`. Returns the
 * account email when the cloud validates it, else null — token revoked/expired,
 * or the cloud unreachable. Lets `login` / `init` say "already logged in"
 * instead of re-running the device flow.
 */
export async function verifyCredential(
  cloudUrl: string,
  token: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const found = await fetchAccount(cloudUrl, token, timeoutMs);
  return found.status === "ok" ? found.account.email : null;
}

const sleepCancelable = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });

/**
 * Run the velloo-cloud OAuth device-authorization flow against `cloudUrl`:
 * fetch the issuer config, request a device code, open the browser, poll for
 * the access token, then exchange it for a `vlk_` CLI token. Returns the token
 * + email; the caller persists it (`saveCredential`).
 *
 * Throws on any failure (cloud unreachable, code expired, exchange error) so
 * callers choose how to surface it — the `login` command exits via `fail`; the
 * init wizard catches and shows a soft note, then continues. `onPrompt` is
 * called once with the verification URL + user code (and how long they stay
 * valid), so each caller can render them in its own style — plain console,
 * clack note, or the canvas sign-in dialog.
 */
export async function performDeviceLogin(
  cloudUrl: string,
  onPrompt: (info: {
    verificationUrl: string;
    userCode: string;
    /** Seconds until the code expires. */
    expiresIn: number;
  }) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<DeviceLoginResult> {
  // The flow receives + returns the vlk_ token; refuse a cleartext channel.
  assertSecureCloudUrl(cloudUrl);
  const configRes = await fetch(`${cloudUrl}/v1/auth/config`).catch(() => null);
  if (!configRes?.ok) throw new Error(`cannot reach ${cloudUrl} — is velloo-cloud up?`);
  const config = AuthConfigResponseSchema.safeParse(await configRes.json().catch(() => null));
  const issuer = config.success ? config.data.issuer : undefined;
  const clientId = config.success ? config.data.clientId : undefined;
  if (issuer === undefined || clientId === undefined) {
    throw new Error(`${cloudUrl} does not advertise a sign-in service — is velloo-cloud current?`);
  }

  const codeRes = await fetch(`${issuer}/api/auth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  }).catch(() => null);
  if (!codeRes?.ok) throw new Error(`the auth service at ${issuer} is not answering — is it up?`);
  const deviceBody = DeviceCodeResponseSchema.safeParse(await codeRes.json().catch(() => null));
  if (!deviceBody.success) {
    throw new Error(`the auth service at ${issuer} answered something this velloo can't read`);
  }
  const device = deviceBody.data;

  // Await the prompt so a caller can confirm (e.g. "press Enter") before we open
  // the browser; the browser opens only once it resolves.
  await onPrompt({
    verificationUrl: device.verification_uri_complete,
    userCode: device.user_code,
    expiresIn: device.expires_in,
  });
  // Fire-and-forget: polling must start now, and the printed URL is the
  // fallback — never wait on the opener (some block until the browser closes).
  void openUrl(device.verification_uri_complete);

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(1, device.interval) * 1000;
  let accessToken: string | null = null;
  const abortSignal = signal ?? new AbortController().signal;
  while (Date.now() < deadline) {
    await sleepCancelable(intervalMs, abortSignal);
    const res = await fetch(`${issuer}/api/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: clientId,
      }),
      signal: abortSignal,
    });
    const polled = DeviceTokenResponseSchema.safeParse(await res.json().catch(() => ({})));
    const body = polled.success ? polled.data : {};
    if (body.access_token) {
      accessToken = body.access_token;
      break;
    }
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    throw new Error(body.error_description ?? body.error ?? "device authorization failed");
  }
  if (!accessToken) throw new Error("the sign-in code expired — run velloo login again");

  const exchangeRes = await fetch(`${cloudUrl}/v1/auth/cli-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
  if (exchangeRes.status !== 201) {
    const { detail } = await readFailure(exchangeRes);
    throw new Error(`token exchange failed (${exchangeRes.status}): ${detail}`);
  }
  const exchanged = CliTokenResponseSchema.safeParse(await exchangeRes.json().catch(() => null));
  if (!exchanged.success) {
    throw new Error(`${cloudUrl} returned a sign-in token this velloo can't read`);
  }
  return exchanged.data;
}
