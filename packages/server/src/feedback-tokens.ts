import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { RSABSSA } from "@cloudflare/blindrsa-ts";
import type { CloudAuth } from "./cloud.ts";
import { PINNED_ISSUER_KEYS } from "./feedback-issuer-pins.ts";
import { writeJsonAtomic } from "./fs.ts";

/**
 * The client half of anonymous feedback (RFC 9474 blind RSA, the Privacy
 * Pass pattern). Everything that matters for the trust story happens HERE,
 * in the open-source CLI, where anyone can audit it:
 *
 *   1. Issuance (authenticated): we generate random tokens, BLIND them, and
 *      have the cloud sign the blinded values. The cloud never sees the
 *      tokens, so its issuance logs cannot be joined to later redemptions —
 *      that is a property of the math, not of server-side logging policy.
 *   2. Redemption (anonymous): `send_feedback` with `contactOk: false`
 *      spends one unblinded token+signature on an endpoint that carries NO
 *      account credential. The cloud can verify "a real signed-in velloo
 *      user" and nothing more.
 *   3. Key pinning: the issuer's public key for the production cloud is
 *      committed in feedback-issuer-pins.ts (generated + committed by the
 *      cloud's deploy). A malicious issuer could otherwise tag users with
 *      per-user keys — pinned clients would reject those signatures.
 *
 * Tokens are issued in batches (at `velloo login` and topped up here), so a
 * redemption doesn't time-correlate with its issuance. Honest limits: the
 * server still sees an IP, and "some velloo user" is only as anonymous as
 * the user base is large.
 */

export const TOKEN_SCHEME = "RSABSSA-SHA384.PSS.Randomized";
const suite = RSABSSA.SHA384.PSS.Randomized();
const KEY_ALG = { name: "RSA-PSS", hash: "SHA-384" } as const;

/** Tokens fetched per issuance batch (well under the cloud's monthly quota). */
const BATCH = 10;

interface StoredToken {
  /** Prepared token, base64 (64 bytes). */
  token: string;
  /** Finalized signature, base64 (256 bytes). */
  sig: string;
}

interface StoreEntry {
  scheme: string;
  /** Issuer public key (SPKI b64) these tokens verify against (TOFU record). */
  publicKey: string;
  tokens: StoredToken[];
}

type Store = Record<string, StoreEntry>;

export const defaultTokenStorePath = () => join(homedir(), ".velloo", "feedback-tokens.json");

async function loadStore(path: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Store;
  } catch {
    return {};
  }
}

async function saveStore(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, store);
}

const originOf = (url: string) => new URL(url).origin;

/**
 * Fetch the cloud's issuer key and hold it to the pinning policy: a pinned
 * origin must match exactly; an unpinned origin must match what this store
 * saw first (TOFU). Throws with a human-readable reason on any mismatch.
 */
async function fetchIssuerKey(
  cloudUrl: string,
  prior: StoreEntry | undefined,
): Promise<{ publicKey: CryptoKey; spkiB64: string }> {
  const res = await fetch(`${cloudUrl}/v1/feedback/token-key`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`token key fetch failed (${res.status})`);
  const { scheme, publicKey } = (await res.json()) as { scheme?: string; publicKey?: string };
  if (scheme !== TOKEN_SCHEME || !publicKey) {
    throw new Error(`unsupported feedback token scheme ${JSON.stringify(scheme)}`);
  }

  const pinned = PINNED_ISSUER_KEYS[originOf(cloudUrl)];
  if (pinned && publicKey !== pinned) {
    throw new Error(
      "the cloud's feedback issuer key does not match the key pinned in this velloo build — refusing to fetch tokens (a per-user key would deanonymize feedback).",
    );
  }
  if (!pinned && prior && prior.publicKey !== publicKey) {
    throw new Error(
      `the cloud's feedback issuer key changed since tokens were first issued — refusing to fetch more. If the rotation is expected, delete ${defaultTokenStorePath()} and retry.`,
    );
  }

  const key = await crypto.subtle.importKey(
    "spki",
    Buffer.from(publicKey, "base64"),
    KEY_ALG,
    true,
    ["verify"],
  );
  return { publicKey: key, spkiB64: publicKey };
}

/**
 * Ensure at least `min` unspent tokens are stored for this cloud, blinding
 * and fetching a batch over the authenticated channel when short. Requires
 * `cloud.token`; throws with the reason on any failure (caller decides how
 * soft that is).
 */
export async function topUpTokens(
  cloud: CloudAuth,
  min = 1,
  storePath = defaultTokenStorePath(),
): Promise<void> {
  const store = await loadStore(storePath);
  const origin = originOf(cloud.url);
  const entry = store[origin];
  if ((entry?.tokens.length ?? 0) >= min) return;
  if (!cloud.token) throw new Error("not signed in — run `velloo login` to fetch feedback tokens");

  const issuer = await fetchIssuerKey(cloud.url, entry);

  const blinds: { prepared: Uint8Array; blindedMsg: Uint8Array; inv: Uint8Array }[] = [];
  for (let i = 0; i < BATCH; i++) {
    const prepared = suite.prepare(crypto.getRandomValues(new Uint8Array(32)));
    blinds.push({ prepared, ...(await suite.blind(issuer.publicKey, prepared)) });
  }
  const res = await fetch(`${cloud.url}/v1/feedback/tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cloud.token}`,
    },
    body: JSON.stringify({
      blinded: blinds.map((b) => Buffer.from(b.blindedMsg).toString("base64")),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token issuance failed (${res.status})`);
  const { signatures } = (await res.json()) as { signatures?: string[] | undefined };
  if (!Array.isArray(signatures) || signatures.length !== blinds.length) {
    throw new Error("token issuance returned a malformed signature batch");
  }

  const tokens: StoredToken[] = [];
  for (let i = 0; i < blinds.length; i++) {
    const b = blinds[i];
    if (!b) continue;
    const sig = await suite.finalize(
      issuer.publicKey,
      b.prepared,
      Buffer.from(signatures[i] ?? "", "base64"),
      b.inv,
    );
    // Verify locally before trusting the token — a bad signature would only
    // surface at redemption time otherwise.
    if (!(await suite.verify(issuer.publicKey, sig, b.prepared))) {
      throw new Error("issued token failed local verification — not storing it");
    }
    tokens.push({
      token: Buffer.from(b.prepared).toString("base64"),
      sig: Buffer.from(sig).toString("base64"),
    });
  }

  store[origin] = {
    scheme: TOKEN_SCHEME,
    publicKey: issuer.spkiB64,
    tokens: [...(entry?.tokens ?? []), ...tokens],
  };
  await saveStore(storePath, store);
}

/** Pop one token off the store, persisting the removal BEFORE it is used —
 * a crash mid-send then loses a token instead of double-spending one. */
async function popToken(cloudUrl: string, storePath: string): Promise<StoredToken | null> {
  const store = await loadStore(storePath);
  const entry = store[originOf(cloudUrl)];
  const token = entry?.tokens.shift();
  if (!entry || !token) return null;
  await saveStore(storePath, store);
  return token;
}

export interface AnonymousFeedbackResult {
  ok: boolean;
  message: string;
}

/**
 * Send one anonymous feedback message: spend a blind token on the
 * unauthenticated endpoint. Tops the store up first when empty (which needs
 * the signed-in channel); retries once if the cloud reports the token
 * already spent (a stale store). Never throws.
 */
export async function sendAnonymousFeedback(
  cloud: CloudAuth,
  payload: { body: string; toolVersion?: string; source?: string },
  storePath = defaultTokenStorePath(),
): Promise<AnonymousFeedbackResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await topUpTokens(cloud, 1, storePath);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const token = await popToken(cloud.url, storePath);
    if (!token) return { ok: false, message: "no feedback tokens available" };

    try {
      // Deliberately no authorization header — this request carries nothing
      // that identifies the account; the blind-signed token is the proof.
      const res = await fetch(`${cloud.url}/v1/feedback/anonymous`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: payload.body,
          ...(payload.toolVersion ? { toolVersion: payload.toolVersion } : {}),
          ...(payload.source ? { source: payload.source } : {}),
          token: token.token,
          signature: token.sig,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 409) continue; // stale/spent token — try the next one
      if (!res.ok) return { ok: false, message: `feedback not sent (${res.status})` };
      return { ok: true, message: "Thanks — your feedback was sent (anonymously)." };
    } catch {
      return { ok: false, message: "Couldn't reach velloo-cloud; feedback not sent." };
    }
  }
  return { ok: false, message: "feedback tokens kept colliding — try again later" };
}
