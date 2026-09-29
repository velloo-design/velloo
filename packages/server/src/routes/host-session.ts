import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface StoredCookie {
  value: string;
  /** Epoch ms; absent for a session cookie. */
  expires?: number;
}

/**
 * The daemon's one session with the host app. Cookies the app sets through the
 * proxy are kept here, not in the browser, and sent on every proxied request —
 * so signing in once, in any preview, signs in every frame, the agent's
 * screenshots and compares, and a publish snapshot alike. The browser never
 * holds the app's cookies, so none can leak to the daemon's own routes.
 *
 * Saved in the design's `.design/cache/` (never committed) so a daemon restart
 * or a CLI publish keeps the session; one app per design, so names are the key.
 */
export class HostSession {
  private readonly cookies = new Map<string, StoredCookie>();

  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredCookie>;
      for (const [name, cookie] of Object.entries(saved)) {
        if (typeof cookie?.value === "string") this.cookies.set(name, cookie);
      }
    } catch {
      // No session yet.
    }
  }

  /** The session saved for the design folder at `root`. */
  static forFolder(root: string): HostSession {
    return new HostSession(join(root, ".design", "cache", "host-session.json"));
  }

  /** The `Cookie` header for the next request, or undefined with nothing live. */
  header(now = Date.now()): string | undefined {
    const live = [...this.cookies].filter(([, c]) => c.expires === undefined || c.expires > now);
    return live.length > 0 ? live.map(([name, c]) => `${name}=${c.value}`).join("; ") : undefined;
  }

  /**
   * Take in a response's `Set-Cookie`s. True only when a cookie arrived or
   * went — a sign-in or sign-out — not when one was refreshed: apps that roll
   * their session on every response would otherwise reload every frame, which
   * requests again, which rolls it again.
   */
  absorb(setCookies: string[], now = Date.now()): boolean {
    let changed = false;
    let signed = false;
    for (const line of setCookies) {
      const [pair = "", ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      let expires: number | undefined;
      for (const attribute of attributes) {
        const [key = "", raw = ""] = attribute.split("=", 2).map((part) => part.trim());
        if (key.toLowerCase() === "max-age") expires = now + Number(raw) * 1000;
        else if (key.toLowerCase() === "expires" && expires === undefined) {
          const at = Date.parse(raw);
          if (!Number.isNaN(at)) expires = at;
        }
      }
      const gone = value === "" || (expires !== undefined && expires <= now);
      const before = this.cookies.get(name);
      if (gone) {
        if (before) {
          this.cookies.delete(name);
          changed = signed = true;
        }
        continue;
      }
      if (before?.value !== value || before.expires !== expires) {
        this.cookies.set(name, { value, ...(expires === undefined ? {} : { expires }) });
        changed = true;
        if (!before) signed = true;
      }
    }
    if (changed) this.save();
    return signed;
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.cookies)), { mode: 0o600 });
    } catch (error) {
      console.error("velloo: couldn't save the host app session:", error);
    }
  }
}
