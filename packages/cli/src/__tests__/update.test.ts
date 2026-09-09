import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareVersions,
  installMethod,
  isNewerRelease,
  latestVersionUrl,
  releaseChannel,
} from "../release.ts";
import {
  fetchLatestVersion,
  maybeNotifyAboutUpdate,
  refreshUpdateCache,
  updateStatus,
  upgradeInstalledVelloo,
} from "../update.ts";

let root: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-update-test-"));
  originalEnv = { ...process.env };
  process.env.VELLOO_UPDATE_CACHE = join(root, "update.json");
  process.env.VELLOO_UPDATE_URL = "data:application/json,%7B%22version%22%3A%220.2.0%22%7D";
  process.env.VELLOO_LOCAL_RELEASE = join(root, "local-release.json");
});

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  await rm(root, { recursive: true, force: true });
});

describe("version updates", () => {
  test("compares releases and prereleases", () => {
    expect(compareVersions("1.4.0", "1.3.14")).toBe(1);
    expect(compareVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("1.4.0-beta.2", "1.4.0")).toBe(-1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
  });

  test("recognizes install-channel metadata, and Homebrew by its Cellar path", () => {
    expect(installMethod({ VELLOO_INSTALL_METHOD: "npm" })).toBe("npm");
    expect(installMethod({ VELLOO_INSTALL_METHOD: "direct" })).toBe("direct");
    expect(installMethod({ VELLOO_INSTALL_METHOD: "source" })).toBe("source");
    expect(installMethod({ VELLOO_INSTALL_METHOD: "local" })).toBe("local");
    expect(installMethod({})).toBe("unknown");
    // A formula that wraps the npm package still declares "npm"; the path is
    // what says brew owns those files and must be the one to replace them.
    expect(
      installMethod({
        VELLOO_INSTALL_METHOD: "npm",
        VELLOO_LAUNCHER_PATH: "/opt/homebrew/Cellar/velloo/0.2.0/libexec/launcher.cjs",
      }),
    ).toBe("homebrew");
    // npm's own global prefix under a Homebrew-installed Node is NOT Homebrew.
    expect(
      installMethod({
        VELLOO_INSTALL_METHOD: "npm",
        VELLOO_LAUNCHER_PATH: "/opt/homebrew/lib/node_modules/velloo/launcher.cjs",
      }),
    ).toBe("npm");
  });

  test("asks each channel's own host what the latest release is", () => {
    // Only an npm install on stable can trust the registry: it is the artifact
    // `npm install -g velloo@latest` would actually resolve.
    expect(latestVersionUrl({ VELLOO_INSTALL_METHOD: "npm" })).toContain("registry.npmjs.org");
    expect(latestVersionUrl({ VELLOO_INSTALL_METHOD: "direct" })).toBe(
      "https://get.velloo.design/latest.json",
    );
    expect(latestVersionUrl({ VELLOO_INSTALL_METHOD: "npm", VELLOO_RELEASE_CHANNEL: "dev" })).toBe(
      "https://get.dev.velloo.design/latest.json",
    );
    expect(
      latestVersionUrl({
        VELLOO_INSTALL_METHOD: "direct",
        VELLOO_DOWNLOAD_BASE: "https://x.test/",
      }),
    ).toBe("https://x.test/latest.json");
    expect(releaseChannel({ VELLOO_RELEASE_CHANNEL: "nonsense" })).toBe("stable");
  });

  test("orders local builds by build time, since their version never moves", () => {
    const running = { version: "0.1.0", build: "0.1.0 (aaa)", builtAt: 1_000 };
    expect(isNewerRelease({ version: "0.1.0", builtAt: 2_000 }, running)).toBe(true);
    expect(isNewerRelease({ version: "0.1.0", builtAt: 500 }, running)).toBe(false);
    // A rebuild of a *released* version is not an upgrade when neither side
    // carries a build time.
    expect(isNewerRelease({ version: "0.1.0" }, { version: "0.1.0" })).toBe(false);
    // A binary from before build stamping loses to anything that carries one.
    expect(isNewerRelease({ version: "0.1.0", builtAt: 1 }, { version: "0.1.0" })).toBe(true);
    expect(isNewerRelease({ version: "0.2.0", builtAt: 1 }, running)).toBe(true);
  });

  test("fetches and caches a release without network access", async () => {
    expect(await fetchLatestVersion()).toBe("0.2.0");
    await refreshUpdateCache();
    const cached = JSON.parse(await readFile(process.env.VELLOO_UPDATE_CACHE as string, "utf8"));
    expect(cached.latest).toBe("0.2.0");
    expect(cached.checkedAt).toBeNumber();
  });

  test("isolates release-check failures", async () => {
    process.env.VELLOO_UPDATE_URL = "data:application/json,not-json";
    await expect(refreshUpdateCache()).resolves.toBeUndefined();
    await expect(readFile(process.env.VELLOO_UPDATE_CACHE as string)).rejects.toBeDefined();
  });

  test("prints a cached update notice once without a foreground network request", async () => {
    const now = Date.now();
    process.env.VELLOO_INSTALL_METHOD = "direct";
    await writeFile(
      process.env.VELLOO_UPDATE_CACHE as string,
      JSON.stringify({ checkedAt: now, latest: "0.2.0" }),
    );
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await maybeNotifyAboutUpdate({ isTTY: true, now });
      const firstCalls = error.mock.calls.flat().join("\n");
      expect(firstCalls).toContain("Update available:");
      expect(firstCalls).toContain("velloo upgrade");
      error.mockClear();
      await maybeNotifyAboutUpdate({ isTTY: true, now: now + 1_000 });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("tells a contributor about a fresh local build on the very next command", async () => {
    // The cache says nothing is pending; the marker `cli:build` just wrote
    // says otherwise. A file read costs nothing, so the notice must not wait
    // for the background refresh to land on some later command.
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_RELEASE_CHANNEL = "local";
    delete process.env.VELLOO_UPDATE_URL;
    await writeFile(
      process.env.VELLOO_LOCAL_RELEASE as string,
      JSON.stringify({
        version: "0.1.0",
        build: "0.1.0 (fresh)",
        builtAt: Date.now(),
        tarball: join(root, "velloo-0.1.0.tgz"),
        repo: root,
      }),
    );
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await maybeNotifyAboutUpdate({ isTTY: true });
      expect(error.mock.calls.flat().join("\n")).toContain("0.1.0 (fresh)");
    } finally {
      error.mockRestore();
    }
  });

  test("reports status without upgrading, and names why it can't", async () => {
    process.env.VELLOO_INSTALL_METHOD = "direct";
    const available = await updateStatus({ refresh: true });
    expect(available.available).toBe(true);
    expect(available.latest).toBe("0.2.0");
    expect(available.upgradable).toBe(true);

    process.env.VELLOO_INSTALL_METHOD = "source";
    const source = await updateStatus({ refresh: true });
    expect(source.upgradable).toBe(false);
    expect(source.available).toBe(false);
    expect(source.reason).toMatch(/running from source/);
  });

  test("dispatches npm upgrades through the npm next to the launcher Node", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "npm-called");
    const fakeNode = join(root, "node");
    const fakeNpm = join(root, "npm");
    await writeFile(fakeNode, "");
    await writeFile(fakeNpm, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$VELLOO_TEST_MARKER"\n');
    await chmod(fakeNpm, 0o755);
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_NODE_EXECUTABLE = fakeNode;
    process.env.VELLOO_NPM_PACKAGE = "velloo";
    process.env.VELLOO_TEST_MARKER = marker;

    const outcome = await upgradeInstalledVelloo();
    expect(outcome.upgraded).toBe(true);
    expect(await readFile(marker, "utf8")).toBe("install -g velloo@0.2.0\n");
  });

  test("points a dev-channel npm upgrade at that channel's tarball, not the registry", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "npm-called");
    const fakeNode = join(root, "node");
    await writeFile(fakeNode, "");
    await writeFile(join(root, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$VELLOO_TEST_MARKER"\n');
    await chmod(join(root, "npm"), 0o755);
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_RELEASE_CHANNEL = "dev";
    process.env.VELLOO_NODE_EXECUTABLE = fakeNode;
    process.env.VELLOO_TEST_MARKER = marker;

    await upgradeInstalledVelloo();
    expect(await readFile(marker, "utf8")).toBe(
      "install -g https://get.dev.velloo.design/velloo.tgz\n",
    );
  });

  test("upgrades a local install from the tarball `cli:build` recorded", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "npm-called");
    const fakeNode = join(root, "node");
    const tarball = join(root, "velloo-0.1.0.tgz");
    await writeFile(fakeNode, "");
    await writeFile(tarball, "");
    await writeFile(join(root, "npm"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$VELLOO_TEST_MARKER"\n');
    await chmod(join(root, "npm"), 0o755);
    await writeFile(
      process.env.VELLOO_LOCAL_RELEASE as string,
      JSON.stringify({
        version: "0.1.0",
        build: "0.1.0 (local)",
        builtAt: Date.now() + 60_000,
        tarball,
        repo: root,
      }),
    );
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_RELEASE_CHANNEL = "local";
    process.env.VELLOO_NODE_EXECUTABLE = fakeNode;
    process.env.VELLOO_TEST_MARKER = marker;
    delete process.env.VELLOO_UPDATE_URL;

    const outcome = await upgradeInstalledVelloo();
    expect(outcome.upgraded).toBe(true);
    expect(outcome.to).toBe("0.1.0 (local)");
    expect(await readFile(marker, "utf8")).toBe(`install -g --include=optional ${tarball}\n`);
  });

  test("says what to run when a local channel has no build recorded", async () => {
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_RELEASE_CHANNEL = "local";
    delete process.env.VELLOO_UPDATE_URL;
    await expect(upgradeInstalledVelloo()).rejects.toThrow(/bun run cli:build/);
  });

  test("dispatches direct upgrades through a downloaded installer", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "installer-called");
    process.env.VELLOO_INSTALL_METHOD = "direct";
    process.env.VELLOO_TEST_MARKER = marker;
    process.env.VELLOO_INSTALLER_URL = `data:text/plain,${encodeURIComponent(
      '#!/bin/bash\nprintf "%s\\n" "$VELLOO_DOWNLOAD_BASE" > "$VELLOO_TEST_MARKER"\n',
    )}`;
    process.env.VELLOO_DOWNLOAD_BASE = "https://get.dev.velloo.design";

    await upgradeInstalledVelloo();
    // The installer must be told which host to pull the archive from, or a dev
    // tester's upgrade quietly moves them to the production release.
    expect(await readFile(marker, "utf8")).toBe("https://get.dev.velloo.design\n");
  });

  test("hands a Homebrew installation to brew rather than overwriting its files", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "brew-called");
    const fakeBrew = join(root, "brew");
    await writeFile(fakeBrew, '#!/bin/sh\nprintf "%s\\n" "$*" > "$VELLOO_TEST_MARKER"\n');
    await chmod(fakeBrew, 0o755);
    process.env.VELLOO_INSTALL_METHOD = "homebrew";
    process.env.VELLOO_TEST_MARKER = marker;
    process.env.PATH = `${root}:${process.env.PATH}`;

    await upgradeInstalledVelloo();
    expect(await readFile(marker, "utf8")).toBe("upgrade velloo\n");
  });

  test("gives source and ambiguous installations actionable errors", async () => {
    process.env.VELLOO_INSTALL_METHOD = "source";
    await expect(upgradeInstalledVelloo()).rejects.toThrow(/running from source/);
    delete process.env.VELLOO_INSTALL_METHOD;
    await expect(upgradeInstalledVelloo()).rejects.toThrow(/could not identify/);
  });

  test("`velloo upgrade --check` reports both halves from inside a design folder", async () => {
    const cli = resolve(import.meta.dir, "../cli.ts");
    const folder = join(root, "design");
    await mkdir(join(folder, ".design"), { recursive: true });
    await writeFile(
      join(folder, ".design", "config.json"),
      JSON.stringify({ schemaVersion: 1, library: { id: "shadcn-react" } }),
    );
    const processResult = Bun.spawn([process.execPath, cli, "upgrade", "--check", folder], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VELLOO_INSTALL_METHOD: "direct",
        VELLOO_UPDATE_URL: process.env.VELLOO_UPDATE_URL as string,
        VELLOO_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const [stdout, , code] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("0.1.0 → 0.2.0 is available (direct installation");
    // …and the same run reports the on-disk format, which is the half that was
    // silently skipped before: a bare `velloo upgrade` only touched the binary.
    expect(stdout).toContain("would migrate");
  });

  test("`velloo upgrade` outside a design folder upgrades only the binary", async () => {
    const cli = resolve(import.meta.dir, "../cli.ts");
    const empty = join(root, "elsewhere");
    await mkdir(empty, { recursive: true });
    const processResult = Bun.spawn([process.execPath, cli, "upgrade", "--check"], {
      cwd: empty,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VELLOO_INSTALL_METHOD: "direct",
        VELLOO_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const [stdout, , code] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("is available (direct installation");
    expect(stdout).not.toContain("schema version");
  });
});
