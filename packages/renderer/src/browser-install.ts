import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

/**
 * The command that installs the headless browser screenshots need. Read from
 * the declared `playwright-core` version rather than written out, because the
 * two have to agree and a hand-kept copy silently stops agreeing the next time
 * the dependency is bumped: the install resolves one Chromium revision and the
 * runtime then refuses to launch anything else, so captures fail with "browser
 * missing" no matter how many times you install it.
 *
 * `--only-shell` fetches just the chromium-headless-shell build (~110MB
 * download) instead of shell + full Chrome for Testing (~300MB) — velloo only
 * ever launches headless, and playwright's headless launches use the shell.
 */
export const PLAYWRIGHT_VERSION: string = (
  pkg as { devDependencies: { "playwright-core": string } }
).devDependencies["playwright-core"];
const PLAYWRIGHT_PIN = `playwright@${PLAYWRIGHT_VERSION}`;
export const CHROMIUM_INSTALL_ARGV = [
  process.execPath,
  "x",
  PLAYWRIGHT_PIN,
  "install",
  "chromium",
  "--only-shell",
] as const;
export const CHROMIUM_INSTALL_CMD = "velloo browser install";

/**
 * The full Chrome-for-Testing install (~300MB) — the fallback for the *headed*
 * capture session, which the headless-shell build above cannot serve: the
 * shell has no UI to show a user. Only needed when the machine has no regular
 * Chrome for `channel: "chrome"` to borrow.
 */
export const CHROMIUM_FULL_INSTALL_ARGV = [
  process.execPath,
  "x",
  PLAYWRIGHT_PIN,
  "install",
  "chromium",
] as const;
export const CHROMIUM_FULL_INSTALL_CMD = "velloo browser install --full";

/**
 * Linux only: the browser download can succeed while the host is missing the
 * shared libraries Chromium links against (playwright prints its "Host system
 * is missing dependencies" box but still exits 0). This installs them via the
 * distro package manager — needs root/sudo.
 */
export const CHROMIUM_DEPS_INSTALL_ARGV = [
  process.execPath,
  "x",
  PLAYWRIGHT_PIN,
  "install-deps",
  "chromium",
] as const;
export const CHROMIUM_DEPS_INSTALL_CMD = "velloo browser install --with-deps";

const INSTALL_HINT =
  "Velloo screenshots need a headless browser. Install it once with:\n" +
  `  ${CHROMIUM_INSTALL_CMD}\n` +
  "Then just retry the tool — the browser is picked up on the next call, no server restart needed. " +
  "(It's an on-demand extra; the canvas itself never needs it.)";

/**
 * Thrown when the headless browser is unavailable — either `playwright-core`
 * is missing or its Chromium binary hasn't been installed. Callers with a TTY
 * (the CLI) can catch this, offer to run `CHROMIUM_INSTALL_CMD`, and retry;
 * agent-facing callers (MCP) surface `.message` as the actionable hint.
 */
export class BrowserMissingError extends Error {
  constructor(message = INSTALL_HINT) {
    super(message);
    this.name = "BrowserMissingError";
  }
}

/**
 * Absolute path to the installed Chromium, or null if its binary hasn't been
 * downloaded yet (or `playwright-core` is absent). A non-launching probe —
 * cheap enough for `velloo init` to report screenshot readiness without
 * opening a browser.
 *
 * Accepts either the full Chrome for Testing build or the headless-shell-only
 * layout our `--only-shell` install produces. `chromium.executablePath()`
 * only knows the full build (the `channel` option is ignored there), so the
 * shell is probed by directory shape: `chromium-<rev>` ⇒
 * `chromium_headless_shell-<rev>/<platform-dir>/chrome-headless-shell[.exe]`.
 * Headless launches use the shell natively, so finding it means ready.
 */
export async function chromiumExecutable(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright-core");
    const path = chromium.executablePath();
    if (!path) return null;
    if (existsSync(path)) return path;
    const m = path.match(/^(.*)[/\\]chromium-(\d+)[/\\]/);
    if (!m?.[1] || !m[2]) return null;
    const shellRoot = join(m[1], `chromium_headless_shell-${m[2]}`);
    if (!existsSync(shellRoot)) return null;
    const bin =
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    for (const sub of readdirSync(shellRoot)) {
      const candidate = join(shellRoot, sub, bin);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}
