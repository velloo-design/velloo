import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { PACKAGE_VERSION } from "./version.ts";

export type InstallMethod = "npm" | "direct" | "source" | "unknown";

interface UpdateCache {
  checkedAt: number;
  latest: string;
  notifiedAt?: number;
  notifiedVersion?: string;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2_000;
const DEFAULT_UPDATE_URL = "https://registry.npmjs.org/velloo/latest";
const DEFAULT_INSTALLER_URL = "https://get.velloo.design/install.sh";

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

export function installMethod(env: NodeJS.ProcessEnv = process.env): InstallMethod {
  if (env.VELLOO_INSTALL_METHOD === "npm" || env.VELLOO_INSTALL_METHOD === "direct") {
    return env.VELLOO_INSTALL_METHOD;
  }
  if (env.VELLOO_INSTALL_METHOD === "source") return "source";
  return "unknown";
}

function cachePath(): string {
  return process.env.VELLOO_UPDATE_CACHE ?? join(homedir(), ".velloo", "update-check.json");
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const value = JSON.parse(await readFile(cachePath(), "utf8")) as Partial<UpdateCache>;
    if (typeof value.checkedAt !== "number" || typeof value.latest !== "string") return null;
    return value as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(value: UpdateCache): Promise<void> {
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

export async function fetchLatestVersion(
  url = process.env.VELLOO_UPDATE_URL ?? DEFAULT_UPDATE_URL,
): Promise<string> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": `velloo/${PACKAGE_VERSION}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`release check returned HTTP ${response.status}`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string" || !/^\d+\.\d+\.\d+/.test(body.version)) {
    throw new Error("release check returned an invalid version");
  }
  return body.version;
}

/** Internal child-process entry: failures are intentionally swallowed. */
export async function refreshUpdateCache(): Promise<void> {
  try {
    const previous = await readCache();
    const latest = await fetchLatestVersion();
    await writeCache({
      checkedAt: Date.now(),
      latest,
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

/**
 * Show only a cached notice, then refresh stale state in a detached child.
 * The foreground command never waits on DNS, TLS, npm, or the network timeout.
 */
export async function maybeNotifyAboutUpdate(
  options: { isTTY?: boolean; now?: number } = {},
): Promise<void> {
  if (
    process.env.VELLOO_DISABLE_UPDATE_CHECK === "1" ||
    process.env.VELLOO_UPDATE_CHECK_CHILD === "1" ||
    !(options.isTTY ?? process.stderr.isTTY) ||
    !["npm", "direct"].includes(installMethod())
  ) {
    return;
  }

  const now = options.now ?? Date.now();
  const cached = await readCache();
  if (cached && compareVersions(cached.latest, PACKAGE_VERSION) > 0) {
    const alreadyNotifiedRecently =
      cached.notifiedVersion === cached.latest &&
      typeof cached.notifiedAt === "number" &&
      now - cached.notifiedAt < CHECK_INTERVAL_MS;
    if (!alreadyNotifiedRecently) {
      console.error("");
      console.error(
        `${pc.yellow("Update available:")} ${PACKAGE_VERSION} → ${cached.latest}. Run ${pc.cyan("velloo upgrade")}.`,
      );
      await writeCache({ ...cached, notifiedAt: now, notifiedVersion: cached.latest }).catch(
        () => {},
      );
    }
  }
  if (!cached || now - cached.checkedAt >= CHECK_INTERVAL_MS) spawnUpdateCheck();
}

function npmExecutable(): string {
  const node = process.env.VELLOO_NODE_EXECUTABLE;
  if (node) {
    const adjacent = join(dirname(node), process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(adjacent)) return adjacent;
  }
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

export async function upgradeInstalledVelloo(options: { checkOnly?: boolean } = {}): Promise<void> {
  const method = installMethod();
  if (method === "source") {
    throw new Error(
      "this Velloo is running from source; update the checkout with your Git workflow",
    );
  }
  if (method === "unknown") {
    throw new Error(
      "could not identify this installation. Reinstall with `npm install -g velloo@latest` or the installer at https://get.velloo.design/install.sh",
    );
  }

  const latest = await fetchLatestVersion();
  if (compareVersions(latest, PACKAGE_VERSION) <= 0) {
    console.log(`velloo: ${PACKAGE_VERSION} is already the latest version.`);
    return;
  }
  if (options.checkOnly) {
    console.log(`velloo: ${PACKAGE_VERSION} → ${latest} is available (${method} installation).`);
    return;
  }

  if (method === "npm") {
    const packageName = process.env.VELLOO_NPM_PACKAGE ?? "velloo";
    await runInherited([npmExecutable(), "install", "-g", `${packageName}@${latest}`]);
  } else {
    const installerUrl = process.env.VELLOO_INSTALLER_URL ?? DEFAULT_INSTALLER_URL;
    const response = await fetch(installerUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`installer download returned HTTP ${response.status}`);
    const directory = await mkdtemp(join(tmpdir(), "velloo-upgrade-"));
    const installer = join(directory, "install.sh");
    try {
      await writeFile(installer, await response.text(), { mode: 0o700 });
      await runInherited(["bash", installer], { ...process.env, VELLOO_VERSION: latest });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  console.log(`velloo: upgraded ${PACKAGE_VERSION} → ${latest} via ${method}.`);
}
