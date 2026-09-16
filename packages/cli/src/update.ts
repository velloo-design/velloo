import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";
import {
  downloadBase,
  fetchLatestRelease,
  type InstallMethod,
  installerUrl,
  installMethod,
  isNewerRelease,
  latestVersionUrl,
  localReleasePath,
  npmExecutable,
  type ReleaseInfo,
  readLocalRelease,
  releaseChannel,
  releaseLabel,
  runningRelease,
  selfUpgradable,
} from "./release.ts";

interface UpdateCache {
  checkedAt: number;
  latest: string;
  /** Build stamp of the cached release, when its channel publishes one. */
  latestBuild?: string;
  /** Epoch ms the cached release was built — the local channel's ordering. */
  latestBuiltAt?: number;
  notifiedAt?: number;
  notifiedVersion?: string;
}

/**
 * The cache file, one entry per release feed. Every velloo on the machine
 * shares it — a dev-channel install beside a contributor's local build is the
 * normal case — so a single unkeyed entry let a local build read the dev
 * host's release back as its own latest and offer to "upgrade" to it.
 */
type UpdateCacheFile = Record<string, UpdateCache>;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A local channel reads a file, so re-check it far more eagerly than a host. */
const LOCAL_CHECK_INTERVAL_MS = 10 * 1000;

/** The feed this installation asks: a local build's marker file, or a URL. */
function releaseSource(): string {
  return releaseChannel() === "local" && !process.env.VELLOO_UPDATE_URL
    ? `file:${localReleasePath()}`
    : latestVersionUrl();
}

function cachePath(): string {
  return process.env.VELLOO_UPDATE_CACHE ?? join(homedir(), ".velloo", "update-check.json");
}

async function readCacheFile(): Promise<UpdateCacheFile> {
  try {
    const value: unknown = JSON.parse(await readFile(cachePath(), "utf8"));
    if (typeof value !== "object" || value === null) return {};
    // Drops the scalar fields of the old single-entry layout along the way.
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => typeof entry === "object" && entry !== null),
    ) as UpdateCacheFile;
  } catch {
    return {};
  }
}

async function readCache(): Promise<UpdateCache | null> {
  const entry: Partial<UpdateCache> | undefined = (await readCacheFile())[releaseSource()];
  if (typeof entry?.checkedAt !== "number" || typeof entry.latest !== "string") return null;
  return entry as UpdateCache;
}

async function writeCache(value: UpdateCache): Promise<void> {
  const path = cachePath();
  const file = { ...(await readCacheFile()), [releaseSource()]: value };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

/** The cached entry as a release, so callers compare one shape. */
function cachedRelease(cache: UpdateCache): ReleaseInfo {
  return {
    version: cache.latest,
    ...(cache.latestBuild === undefined ? {} : { build: cache.latestBuild }),
    ...(cache.latestBuiltAt === undefined ? {} : { builtAt: cache.latestBuiltAt }),
  };
}

/** Back-compat shim for the pre-channel API: the latest version string. */
export async function fetchLatestVersion(): Promise<string> {
  const release = await fetchLatestRelease();
  if (!release) throw new Error("this channel has no published release");
  return release.version;
}

/** Internal child-process entry: failures are intentionally swallowed. */
export async function refreshUpdateCache(): Promise<void> {
  try {
    const previous = await readCache();
    const latest = await fetchLatestRelease();
    if (!latest) return;
    await writeCache({
      checkedAt: Date.now(),
      latest: latest.version,
      ...(latest.build === undefined ? {} : { latestBuild: latest.build }),
      ...(latest.builtAt === undefined ? {} : { latestBuiltAt: latest.builtAt }),
      ...(previous?.notifiedAt ? { notifiedAt: previous.notifiedAt } : {}),
      ...(previous?.notifiedVersion ? { notifiedVersion: previous.notifiedVersion } : {}),
    });
  } catch {}
}

function spawnUpdateCheck(): void {
  const entry = Bun.main;
  const argv = existsSync(entry)
    ? [process.execPath, entry, "__update_check"]
    : [process.execPath, "__update_check"];
  try {
    Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, VELLOO_UPDATE_CHECK_CHILD: "1" },
    }).unref();
  } catch {}
}

function checkIntervalMs(): number {
  return releaseChannel() === "local" ? LOCAL_CHECK_INTERVAL_MS : CHECK_INTERVAL_MS;
}

function checkSuppressed(): boolean {
  return (
    process.env.VELLOO_DISABLE_UPDATE_CHECK === "1" ||
    process.env.VELLOO_UPDATE_CHECK_CHILD === "1" ||
    !selfUpgradable(installMethod())
  );
}

/**
 * Show only a cached notice, then refresh stale state in a detached child.
 * The foreground command never waits on DNS, TLS, npm, or the network timeout.
 *
 * The local channel is the exception: its "release host" is a JSON file this
 * machine just wrote, so it is read in the foreground. A contributor who runs
 * `cli:build` and then a command expects to be told on *that* command, not on
 * the one after it.
 */
export async function maybeNotifyAboutUpdate(
  options: { isTTY?: boolean; now?: number } = {},
): Promise<void> {
  if (checkSuppressed() || !(options.isTTY ?? process.stderr.isTTY)) return;

  const now = options.now ?? Date.now();
  const cached = await readCache();
  const local = releaseChannel() === "local" ? await fetchLatestRelease().catch(() => null) : null;
  const latest = local ?? (cached ? cachedRelease(cached) : null);
  if (latest && isNewerRelease(latest)) {
    const alreadyNotifiedRecently =
      cached?.notifiedVersion === releaseLabel(latest) &&
      typeof cached?.notifiedAt === "number" &&
      now - cached.notifiedAt < checkIntervalMs();
    if (!alreadyNotifiedRecently) {
      const running = runningRelease();
      console.error("");
      console.error(
        `${pc.yellow("Update available:")} ${releaseLabel(running)} → ${releaseLabel(latest)}. Run ${pc.cyan("velloo upgrade")}.`,
      );
      await writeCache({
        checkedAt: cached?.checkedAt ?? now,
        latest: latest.version,
        ...(latest.build === undefined ? {} : { latestBuild: latest.build }),
        ...(latest.builtAt === undefined ? {} : { latestBuiltAt: latest.builtAt }),
        notifiedAt: now,
        notifiedVersion: releaseLabel(latest),
      }).catch(() => {});
    }
  }
  if (!cached || now - cached.checkedAt >= checkIntervalMs()) spawnUpdateCheck();
}

async function runInherited(
  command: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const code = await Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  }).exited;
  if (code !== 0) throw new Error(`\`${command.join(" ")}\` exited with status ${code}`);
}

export interface UpdateStatus {
  method: InstallMethod;
  channel: string;
  /** Build stamp of the running binary. */
  current: string;
  /** Build stamp (or version) of the newest release, null when unknown. */
  latest: string | null;
  available: boolean;
  /** False when this installation can't replace itself (source / unknown). */
  upgradable: boolean;
  /** Why an upgrade can't run here, or why the check couldn't answer. */
  reason?: string;
}

/**
 * The update picture for a caller that wants to *report* it — `velloo status`
 * and the canvas menu. `refresh: false` answers from the cache alone, which is
 * what a UI polling every few minutes should do.
 */
export async function updateStatus(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
  const method = installMethod();
  const channel = releaseChannel();
  const running = runningRelease();
  const base: UpdateStatus = {
    method,
    channel,
    current: releaseLabel(running),
    latest: null,
    available: false,
    upgradable: selfUpgradable(method),
    ...(selfUpgradable(method) ? {} : { reason: unsupportedReason(method) }),
  };
  if (!selfUpgradable(method)) return base;

  let release: ReleaseInfo | null = null;
  if (opts.refresh) {
    try {
      release = await fetchLatestRelease();
      if (release) {
        await writeCache({
          checkedAt: Date.now(),
          latest: release.version,
          ...(release.build === undefined ? {} : { latestBuild: release.build }),
          ...(release.builtAt === undefined ? {} : { latestBuiltAt: release.builtAt }),
        }).catch(() => {});
      }
    } catch (error) {
      return { ...base, reason: error instanceof Error ? error.message : String(error) };
    }
  } else {
    const cached = await readCache();
    if (cached) release = cachedRelease(cached);
    // Nothing cached yet, or the cache is stale — warm it for the next poll
    // without making this call wait on the network.
    if (!cached || Date.now() - cached.checkedAt >= checkIntervalMs()) spawnUpdateCheck();
  }
  if (!release) return base;
  return {
    ...base,
    latest: releaseLabel(release),
    available: isNewerRelease(release, running),
  };
}

function unsupportedReason(method: InstallMethod): string {
  return method === "source"
    ? "this Velloo is running from source; update the checkout with your Git workflow"
    : "could not identify this installation. Reinstall with `npm install -g velloo@latest` or the installer at https://get.velloo.design/install.sh";
}

export interface UpgradeOutcome {
  /** True when a new build was installed. */
  upgraded: boolean;
  from: string;
  /** The release that is now installed (or already was). */
  to: string;
  method: InstallMethod;
  channel: string;
}

/**
 * Replace this installation with the newest release on its channel.
 *
 * Homebrew is deliberately not driven through the archive installer: brew owns
 * the files it wrote, and a self-extract over them leaves the formula's
 * receipt describing a version that is no longer there.
 */
export async function upgradeInstalledVelloo(
  options: { checkOnly?: boolean } = {},
): Promise<UpgradeOutcome> {
  const method = installMethod();
  const channel = releaseChannel();
  const running = runningRelease();
  if (!selfUpgradable(method)) throw new Error(unsupportedReason(method));

  const latest = await fetchLatestRelease();
  if (!latest) {
    throw new Error(
      channel === "local"
        ? `no local build found at ${localReleasePath()} — run \`bun run cli:build\` in the velloo checkout first`
        : "this channel has no published release",
    );
  }
  const done = (upgraded: boolean): UpgradeOutcome => ({
    upgraded,
    from: releaseLabel(running),
    to: releaseLabel(latest),
    method,
    channel,
  });

  if (!isNewerRelease(latest, running)) {
    console.log(`velloo: ${releaseLabel(running)} is already the latest ${channel} build.`);
    return done(false);
  }
  if (options.checkOnly) {
    console.log(
      `velloo: ${releaseLabel(running)} → ${releaseLabel(latest)} is available (${method} installation, ${channel} channel).`,
    );
    return done(false);
  }

  if (method === "homebrew") {
    await runInherited(["brew", "upgrade", process.env.VELLOO_BREW_FORMULA ?? "velloo"]);
  } else if (channel === "local") {
    await upgradeFromLocalBuild();
  } else if (method === "npm") {
    const packageName = process.env.VELLOO_NPM_PACKAGE ?? "velloo";
    // A dev-channel release never reaches the registry, so npm is pointed at
    // the channel's own tarball rather than at a version specifier.
    const spec =
      channel === "dev" ? `${downloadBase()}/velloo.tgz` : `${packageName}@${latest.version}`;
    await runInherited([npmExecutable(), "install", "-g", spec]);
  } else {
    const response = await fetch(installerUrl(), { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`installer download returned HTTP ${response.status}`);
    const directory = await mkdtemp(join(tmpdir(), "velloo-upgrade-"));
    const installer = join(directory, "install.sh");
    try {
      await writeFile(installer, await response.text(), { mode: 0o700 });
      await runInherited(["bash", installer], {
        ...process.env,
        VELLOO_VERSION: latest.version,
        VELLOO_DOWNLOAD_BASE: downloadBase(),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(`velloo: upgraded ${releaseLabel(running)} → ${releaseLabel(latest)} via ${method}.`);
  return done(true);
}

/**
 * Install the tarball the contributor's last `bun run cli:build` packed. The
 * artifact is an ordinary npm package, so this is the same command
 * `bun run cli:install` runs — the point of the channel is only that
 * `velloo upgrade` can find it without them retyping the path.
 */
async function upgradeFromLocalBuild(): Promise<void> {
  const local = await readLocalRelease();
  if (!local) throw new Error("no local build recorded — run `bun run cli:build` first");
  if (!existsSync(local.tarball)) {
    throw new Error(
      `the recorded local build is gone (${local.tarball}) — run \`bun run cli:build\` in ${local.repo} again`,
    );
  }
  await runInherited([npmExecutable(), "install", "-g", "--include=optional", local.tarball]);
}
