import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BUILD_TIME_MS, PACKAGE_VERSION, TOOL_VERSION } from "./version.ts";

/**
 * Where this velloo came from, and therefore how it updates itself.
 *
 * `npm` / `direct` / `homebrew` are the three shipping installers;
 * `local` is a `bun run cli:build` artifact a contributor installed over
 * their own copy; `source` is `bun run velloo` in the checkout; `unknown`
 * is an installation that carries no marker at all.
 */
export type InstallMethod = "npm" | "direct" | "homebrew" | "local" | "source" | "unknown";

/**
 * Which stream of releases this binary tracks. Baked at build time (see
 * packages/cli/build.ts) so a dev-channel artifact never upgrades itself into
 * the production release, and a locally built one upgrades from the
 * contributor's own `cli:build` output rather than from the internet.
 */
export type ChannelId = "stable" | "dev" | "local";

declare const __VELLOO_RELEASE_CHANNEL__: string;

const DEFAULT_DOWNLOAD_BASE: Record<Exclude<ChannelId, "local">, string> = {
  stable: "https://get.velloo.design",
  dev: "https://get.dev.velloo.design",
};

const NPM_LATEST_URL = "https://registry.npmjs.org/velloo/latest";

/** Marker `bun run cli:build` writes so a local install can find the new build. */
export function localReleasePath(): string {
  return process.env.VELLOO_LOCAL_RELEASE ?? join(homedir(), ".velloo", "local-release.json");
}

export interface LocalRelease {
  /** Package version — unchanged between local builds, so never the comparison key. */
  version: string;
  /** The build stamp (`0.1.0 (sha-dirty · date)`), which IS user-visible. */
  build: string;
  /** Epoch ms the bundle was built; the only ordering a local channel has. */
  builtAt: number;
  /** Absolute path to the packed tarball `npm install -g` consumes. */
  tarball: string;
  /** The checkout it came from, for the error message when the tarball is gone. */
  repo: string;
}

export async function readLocalRelease(): Promise<LocalRelease | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(localReleasePath(), "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw as Partial<LocalRelease>;
    if (typeof value.builtAt !== "number" || typeof value.tarball !== "string") return null;
    return {
      version: typeof value.version === "string" ? value.version : PACKAGE_VERSION,
      build: typeof value.build === "string" ? value.build : (value.version ?? PACKAGE_VERSION),
      builtAt: value.builtAt,
      tarball: value.tarball,
      repo: typeof value.repo === "string" ? value.repo : dirname(value.tarball),
    };
  } catch {
    return null;
  }
}

/**
 * Homebrew's formula installs into `<prefix>/Cellar/velloo/<version>`, and
 * that path is the only reliable tell: a Homebrew-installed *Node* puts npm's
 * global packages under `/opt/homebrew/lib/node_modules` too, so a prefix test
 * would call every npm install on a Mac "homebrew".
 */
function looksLikeHomebrew(env: NodeJS.ProcessEnv): boolean {
  const entry = env.VELLOO_LAUNCHER_PATH ?? Bun.main;
  if (!entry) return false;
  try {
    return /[/\\]Cellar[/\\]velloo[/\\]/.test(realpathSync(entry));
  } catch {
    return /[/\\]Cellar[/\\]velloo[/\\]/.test(entry);
  }
}

const EXPLICIT: readonly InstallMethod[] = ["npm", "direct", "homebrew", "local", "source"];

export function installMethod(env: NodeJS.ProcessEnv = process.env): InstallMethod {
  const declared = env.VELLOO_INSTALL_METHOD;
  if (declared && (EXPLICIT as readonly string[]).includes(declared)) {
    // The npm launcher declares "npm" unconditionally, so a formula that wraps
    // the npm package still reads as Homebrew from its install path.
    if (declared === "npm" && looksLikeHomebrew(env)) return "homebrew";
    return declared as InstallMethod;
  }
  if (looksLikeHomebrew(env)) return "homebrew";
  return "unknown";
}

/** True when this installation can replace itself in place. */
export function selfUpgradable(method: InstallMethod): boolean {
  return method === "npm" || method === "direct" || method === "homebrew" || method === "local";
}

export function releaseChannel(env: NodeJS.ProcessEnv = process.env): ChannelId {
  const declared = env.VELLOO_RELEASE_CHANNEL ?? bakedChannel();
  return declared === "dev" || declared === "local" ? declared : "stable";
}

function bakedChannel(): string | undefined {
  return typeof __VELLOO_RELEASE_CHANNEL__ === "string" ? __VELLOO_RELEASE_CHANNEL__ : undefined;
}

/**
 * The host this binary downloads from. Baked into the `curl | sh` wrapper at
 * artifact-build time so a dev install stays on the dev host, with the channel
 * table as the fallback for installs that carry no marker (npm, Homebrew).
 */
export function downloadBase(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.VELLOO_DOWNLOAD_BASE;
  if (explicit) return explicit.replace(/\/+$/, "");
  const channel = releaseChannel(env);
  return DEFAULT_DOWNLOAD_BASE[channel === "local" ? "stable" : channel];
}

export function installerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.VELLOO_INSTALLER_URL ?? `${downloadBase(env)}/install.sh`;
}

/**
 * Where "what is the latest velloo?" is answered for this installation.
 *
 * npm on the stable channel asks the registry, because that is the artifact
 * `npm install -g` would actually resolve. Everything else asks its own
 * download host — a dev-channel release never reaches npm, and the direct
 * archives are cut independently of the npm publish, so the registry would be
 * answering about a different artifact than the one we'd install.
 */
export function latestVersionUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VELLOO_UPDATE_URL) return env.VELLOO_UPDATE_URL;
  const channel = releaseChannel(env);
  if (channel === "stable" && installMethod(env) === "npm") return NPM_LATEST_URL;
  return `${downloadBase(env)}/latest.json`;
}

export interface ReleaseInfo {
  /** Package version of the newest release on this channel. */
  version: string;
  /** Its build stamp when the channel publishes one (local builds do). */
  build?: string;
  /** Epoch ms — only the local channel orders by time. */
  builtAt?: number;
}

/**
 * The running build, as the same shape a release advertises, so the two are
 * compared field-for-field rather than through two parallel code paths.
 */
export function runningRelease(): ReleaseInfo {
  return {
    version: PACKAGE_VERSION,
    build: TOOL_VERSION,
    ...(BUILD_TIME_MS === undefined ? {} : { builtAt: BUILD_TIME_MS }),
  };
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): { core: number[]; prerelease: string | null } | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
    if (!match) return null;
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] ?? null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index++) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

/**
 * Is `candidate` newer than what is running?
 *
 * The local channel never bumps the package version — every `cli:build` of a
 * work-in-progress branch is `0.1.0` — so it orders by build time instead.
 * Both signals are needed: a released channel must not regard a *rebuild* of
 * the same version as an upgrade, and a local one has nothing else to go on.
 */
export function isNewerRelease(candidate: ReleaseInfo, running = runningRelease()): boolean {
  const byVersion = compareVersions(candidate.version, running.version);
  if (byVersion !== 0) return byVersion > 0;
  if (typeof candidate.builtAt !== "number") return false;
  // A running build with no timestamp predates build-time stamping, so a
  // candidate that has one is by definition the newer of the two.
  if (typeof running.builtAt !== "number") return true;
  return candidate.builtAt > running.builtAt;
}

/** How a release identifies itself in output: the build stamp when it has one. */
export function releaseLabel(info: ReleaseInfo): string {
  return info.build ?? info.version;
}

const FETCH_TIMEOUT_MS = 2_000;

/**
 * The newest release on this channel, or null when the channel has nothing to
 * offer (a local channel with no `cli:build` yet). Throws on a reachable but
 * broken endpoint — the caller decides whether that is fatal.
 */
export async function fetchLatestRelease(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseInfo | null> {
  if (releaseChannel(env) === "local" && !env.VELLOO_UPDATE_URL) {
    const local = await readLocalRelease();
    if (!local) return null;
    return { version: local.version, build: local.build, builtAt: local.builtAt };
  }
  const response = await fetch(latestVersionUrl(env), {
    headers: { accept: "application/json", "user-agent": `velloo/${PACKAGE_VERSION}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`release check returned HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.version !== "string" || !/^\d+\.\d+\.\d+/.test(body.version)) {
    throw new Error("release check returned an invalid version");
  }
  return {
    version: body.version,
    ...(typeof body.build === "string" ? { build: body.build } : {}),
    ...(typeof body.builtAt === "number" ? { builtAt: body.builtAt } : {}),
  };
}

/**
 * The `velloo` executable an upgrade will have just written, so the rest of an
 * upgrade (the folder migration, or a re-run of `init`) happens on the NEW
 * binary — the running process is still the old one, and only the new one
 * knows the schema version it migrated the folder towards.
 *
 * Returns null when the location can't be established; callers then ask the
 * user to re-run rather than guessing at a path.
 */
export function installedVellooBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  const method = installMethod(env);
  if (method === "direct") {
    candidates.push(join(env.VELLOO_BIN_DIR ?? join(homedir(), ".local", "bin"), "velloo"));
  }
  if (method === "homebrew") {
    const prefix = env.HOMEBREW_PREFIX ?? (process.platform === "darwin" ? "/opt/homebrew" : null);
    if (prefix) candidates.push(join(prefix, "bin", "velloo"));
    candidates.push("/usr/local/bin/velloo");
  }
  if (method === "npm" || method === "local") {
    // The launcher runs under the Node that npm ships beside, so its bin
    // directory is where `npm install -g` just linked the new launcher.
    const node = env.VELLOO_NODE_EXECUTABLE;
    if (node) candidates.push(join(dirname(node), "velloo"));
    const prefix = npmGlobalPrefix(env);
    if (prefix) {
      candidates.push(
        process.platform === "win32" ? join(prefix, "velloo.cmd") : join(prefix, "bin", "velloo"),
      );
    }
  }
  return candidates.find((path) => existsSync(path)) ?? null;
}

function npmGlobalPrefix(env: NodeJS.ProcessEnv): string | null {
  try {
    const result = Bun.spawnSync([npmExecutable(env), "prefix", "-g"], { env });
    const out = result.stdout.toString().trim();
    return result.success && out ? out : null;
  } catch {
    return null;
  }
}

export function npmExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const node = env.VELLOO_NODE_EXECUTABLE;
  if (node) {
    const adjacent = join(dirname(node), process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(adjacent)) return adjacent;
  }
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
