import type { UrlCookie } from "./url-capture.ts";

/**
 * A Playwright storage-state document, trimmed to the parts we persist.
 * Mirrors what `BrowserContext.storageState()` returns and what
 * `newContext({ storageState })` accepts, so a scoped file round-trips.
 */
export interface StorageState {
  cookies: StoredCookie[];
  origins: StoredOrigin[];
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; -1 for a session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface StoredOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

/**
 * Public suffixes that sit one level below the TLD, so the registrable domain
 * needs three labels rather than two (`example.co.uk`, not `co.uk`). Applied
 * only under a short TLD, which is the classic ccTLD shape — under `.com` the
 * second label is the registrable one already.
 *
 * A heuristic, deliberately, rather than a vendored public-suffix list: the
 * list is a large moving dependency and the failure it prevents is narrow.
 * Erring toward MORE labels is the safe direction (it drops cookies that could
 * have been kept); erring toward fewer would widen the scope, so anything
 * ambiguous belongs in this set.
 */
const SECOND_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  "ac",
  "asn",
  "biz",
  "co",
  "com",
  "edu",
  "gov",
  "govt",
  "id",
  "in",
  "info",
  "int",
  "ltd",
  "me",
  "mil",
  "ne",
  "net",
  "nom",
  "or",
  "org",
  "plc",
  "sch",
  "web",
]);

/** True for a bare IPv4/IPv6 literal or a single-label host like `localhost`. */
function isHostLiteral(host: string): boolean {
  if (host.includes(":")) return true; // IPv6
  if (/^\d+(\.\d+){3}$/.test(host)) return true;
  return !host.includes(".");
}

/**
 * The registrable domain of a hostname — the cookie-scoping boundary. Cookies
 * outside it belong to somebody else: logging into an app via Google or GitHub
 * SSO leaves the identity provider's own cookies in the jar, and those are the
 * ones that must never be persisted.
 *
 * Literal hosts (`localhost`, an IP) have no registrable domain and are
 * returned as-is, which scopes them to exactly themselves.
 */
export function registrableDomain(host: string): string {
  const h = host.replace(/^\.+/, "").toLowerCase();
  if (isHostLiteral(h)) return h;
  const labels = h.split(".").filter((l) => l.length > 0);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1] ?? "";
  const sld = labels[labels.length - 2] ?? "";
  const take = tld.length <= 3 && SECOND_LEVEL_SUFFIXES.has(sld) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** True when `host` is the registrable domain `base`, or a subdomain of it. */
export function withinRegistrableDomain(host: string, base: string): boolean {
  const h = host.replace(/^\.+/, "").toLowerCase();
  return h === base || h.endsWith(`.${base}`);
}

/**
 * Cookie scoping + expiry pruning, applied on every write of a session file.
 *
 * A headed login hop picks up far more than the target app's session: the
 * identity provider's cookies, analytics, anything else the browser touched.
 * Only cookies on the registrable domain of an origin the user actually
 * captured are persisted — which keeps `auth.example.com` alongside
 * `app.example.com` (same registrable domain, and often where the real session
 * lives) while dropping `google.com` and `github.com`.
 *
 * The cost is bounded and understood: the app's own post-OAuth session cookie
 * is what keeps the capture logged in, so scoping doesn't break captures. It
 * only means that when that session eventually expires the user re-runs the
 * capture command instead of the browser silently re-authenticating.
 */
export function scopeStorageState(
  state: StorageState,
  capturedOrigins: readonly string[],
  now: number = Date.now(),
): StorageState {
  const bases = new Set<string>();
  for (const origin of capturedOrigins) {
    try {
      bases.add(registrableDomain(new URL(origin).hostname));
    } catch {
      // A malformed origin scopes nothing rather than widening the net.
    }
  }
  const nowSec = Math.floor(now / 1000);
  const cookies = state.cookies.filter((c) => {
    // -1 is Playwright's session-cookie marker; a real past expiry is dead
    // weight that would otherwise sit on disk long after it stopped working.
    if (c.expires !== -1 && c.expires <= nowSec) return false;
    const host = c.domain.replace(/^\./, "").toLowerCase();
    for (const base of bases) {
      if (withinRegistrableDomain(host, base)) return true;
    }
    return false;
  });
  const origins = state.origins.filter((o) => {
    try {
      const host = new URL(o.origin).hostname;
      for (const base of bases) {
        if (withinRegistrableDomain(host, base)) return true;
      }
    } catch {
      return false;
    }
    return false;
  });
  return { cookies, origins };
}

/**
 * How long a persisted session file stays usable. A browser session is a
 * bearer credential for the user's real app; past this it's re-login time
 * rather than an indefinitely-resident secret.
 */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** True when a session file written at `writtenAt` has aged out. */
export function sessionExpired(writtenAt: number, now: number = Date.now()): boolean {
  return now - writtenAt > SESSION_TTL_MS;
}

/**
 * The cookies a scoped state can seed into a plain capture context (the
 * `cookies` option on `captureUrlScreenshot`). Values never leave the process
 * that reads the file — this exists so a capture can be authenticated, not so
 * a caller can inspect the jar.
 */
export function seedCookies(state: StorageState): UrlCookie[] {
  return state.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
  }));
}
