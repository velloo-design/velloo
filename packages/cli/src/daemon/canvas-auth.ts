import type { CanvasAccount, CanvasAuth, CanvasAuthStatus, CanvasLogin } from "@velloo/server";
import { topUpTokens } from "@velloo/server";
import { fetchCloudAppUrl } from "../cloud.ts";
import { deleteCredential, loadCredential, saveCredential } from "../cloud-credentials.ts";
import { fetchAccount, performDeviceLogin, revokeCredential } from "../cloud-login.ts";

/**
 * The canvas's account controller. The server package reads no credentials, so
 * the daemon (which is the CLI, and owns `~/.velloo`) implements sign-in state
 * here and threads it into `createServer`.
 *
 * Two things make this more than a credential read. First, the account panel
 * wants the name and plan the cloud knows, which means a `GET /v1/me` — cached,
 * because the canvas polls status. Second, the OAuth device flow can't finish
 * inside one HTTP request: `beginLogin` returns as soon as there's a code to
 * show and leaves the polling loop running in the background, where it writes
 * the credential on success. The canvas watches `login` for the outcome.
 */

/** How long a `/v1/me` answer is reused. Long enough that status polling is free. */
const ACCOUNT_TTL_MS = 60_000;
/** Status polling must never hang the canvas menu on a slow cloud. */
const ACCOUNT_TIMEOUT_MS = 5000;

interface CachedAccount {
  token: string;
  at: number;
  account: CanvasAccount | undefined;
  verified: boolean | null;
}

interface CanvasAuthDependencies {
  /** Test seam for driving the asynchronous device-flow transitions. */
  performDeviceLogin?: typeof performDeviceLogin;
}

export function createCanvasAuth(
  cloudUrl: string,
  dependencies: CanvasAuthDependencies = {},
): CanvasAuth {
  const runDeviceLogin = dependencies.performDeviceLogin ?? performDeviceLogin;
  let login: CanvasLogin = { state: "idle" };
  let pending: AbortController | null = null;
  let cached: CachedAccount | null = null;
  let cachedApp: { at: number; url: string } | null = null;

  /**
   * Who this token belongs to, plus whether the cloud still accepts it. A
   * rejected token keeps its local email (the canvas says "signed in as … —
   * credential expired"); an unreachable cloud is not a rejection.
   */
  const describe = async (
    token: string,
    email: string,
  ): Promise<{ account: CanvasAccount | undefined; verified: boolean | null }> => {
    if (cached && cached.token === token && Date.now() - cached.at < ACCOUNT_TTL_MS) {
      return { account: cached.account, verified: cached.verified };
    }
    const found = await fetchAccount(cloudUrl, token, ACCOUNT_TIMEOUT_MS);
    const resolved =
      found.status === "ok"
        ? { account: found.account, verified: true }
        : {
            account: { email } satisfies CanvasAccount,
            verified: found.status === "rejected" ? false : null,
          };
    cached = { token, at: Date.now(), ...resolved };
    return resolved;
  };

  const resolveAppUrl = async (): Promise<string> => {
    if (cachedApp && Date.now() - cachedApp.at < ACCOUNT_TTL_MS) return cachedApp.url;
    const url = await fetchCloudAppUrl(cloudUrl, ACCOUNT_TIMEOUT_MS);
    cachedApp = { at: Date.now(), url };
    return url;
  };

  const status = async (): Promise<CanvasAuthStatus> => {
    const cred = await loadCredential(cloudUrl);
    const appUrlP = resolveAppUrl();
    if (!cred?.token) {
      return { loggedIn: false, cloudUrl, appUrl: await appUrlP, verified: null, login };
    }
    const [{ account, verified }, appUrl] = await Promise.all([
      describe(cred.token, cred.email),
      appUrlP,
    ]);
    return {
      loggedIn: true,
      cloudUrl,
      appUrl,
      verified,
      login,
      ...(account ? { account } : {}),
    };
  };

  return {
    status,

    async beginLogin() {
      // Idempotent: a second click (or a second tab) joins the pending sign-in
      // rather than starting a competing device code.
      if (login.state === "pending") return status();

      const attempt = new AbortController();
      pending = attempt;
      login = { state: "idle" };

      // Resolves as soon as there's something to tell the user — a code to
      // type, or the reason we never got one.
      let settle: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        settle = resolve;
      });

      const flow = runDeviceLogin(
        cloudUrl,
        ({ verificationUrl, userCode, expiresIn }) => {
          login = {
            state: "pending",
            userCode,
            verificationUrl,
            expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          };
          settle();
        },
        attempt.signal,
      );

      void flow
        .then(async (result) => {
          await saveCredential(cloudUrl, result);
          cached = null;
          login = { state: "idle" };
          // Pre-fetch blind-signed feedback tokens the way `velloo login` does,
          // so a later anonymous send_feedback doesn't correlate with issuance.
          await topUpTokens({ url: cloudUrl, token: result.token }, 10).catch(() => undefined);
        })
        .catch((err: unknown) => {
          // A cancel is a user action, not a failure to report back.
          login = attempt.signal.aborted
            ? { state: "idle" }
            : { state: "error", message: err instanceof Error ? err.message : String(err) };
        })
        .finally(() => {
          if (pending === attempt) pending = null;
          settle();
        });

      await ready;
      return status();
    },

    async cancelLogin() {
      pending?.abort();
      pending = null;
      login = { state: "idle" };
    },

    async logout() {
      pending?.abort();
      pending = null;
      login = { state: "idle" };
      cached = null;
      const stored = await loadCredential(cloudUrl);
      if (stored) await revokeCredential(cloudUrl, stored.token);
      await deleteCredential(cloudUrl);
    },
  };
}
