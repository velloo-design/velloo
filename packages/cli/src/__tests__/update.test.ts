import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareVersions,
  fetchLatestVersion,
  installMethod,
  maybeNotifyAboutUpdate,
  refreshUpdateCache,
  upgradeInstalledVelloo,
} from "../update.ts";

let root: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-update-test-"));
  originalEnv = { ...process.env };
  process.env.VELLOO_UPDATE_CACHE = join(root, "update.json");
  process.env.VELLOO_UPDATE_URL = "data:application/json,%7B%22version%22%3A%220.2.0%22%7D";
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

  test("recognizes only explicit install-channel metadata", () => {
    expect(installMethod({ VELLOO_INSTALL_METHOD: "npm" })).toBe("npm");
    expect(installMethod({ VELLOO_INSTALL_METHOD: "direct" })).toBe("direct");
    expect(installMethod({ VELLOO_INSTALL_METHOD: "source" })).toBe("source");
    expect(installMethod({})).toBe("unknown");
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

  test("dispatches npm upgrades through the npm next to the launcher Node", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "npm-called");
    const fakeNode = join(root, "node");
    const fakeNpm = join(root, "npm");
    await writeFile(fakeNode, "");
    await writeFile(fakeNpm, '#!/bin/sh\nprintf "%s\\n" "$*" > "$VELLOO_TEST_MARKER"\n');
    await chmod(fakeNpm, 0o755);
    process.env.VELLOO_INSTALL_METHOD = "npm";
    process.env.VELLOO_NODE_EXECUTABLE = fakeNode;
    process.env.VELLOO_NPM_PACKAGE = "velloo";
    process.env.VELLOO_TEST_MARKER = marker;

    await upgradeInstalledVelloo();
    expect(await readFile(marker, "utf8")).toBe("install -g velloo@0.2.0\n");
  });

  test("dispatches direct upgrades through a downloaded installer", async () => {
    if (process.platform === "win32") return;
    const marker = join(root, "installer-called");
    process.env.VELLOO_INSTALL_METHOD = "direct";
    process.env.VELLOO_TEST_MARKER = marker;
    process.env.VELLOO_INSTALLER_URL = `data:text/plain,${encodeURIComponent(
      '#!/bin/bash\nprintf "direct\\n" > "$VELLOO_TEST_MARKER"\n',
    )}`;

    await upgradeInstalledVelloo();
    expect(await readFile(marker, "utf8")).toBe("direct\n");
  });

  test("gives source and ambiguous installations actionable errors", async () => {
    process.env.VELLOO_INSTALL_METHOD = "source";
    await expect(upgradeInstalledVelloo()).rejects.toThrow(/running from source/);
    delete process.env.VELLOO_INSTALL_METHOD;
    await expect(upgradeInstalledVelloo()).rejects.toThrow(/could not identify/);
  });

  test("bare `velloo upgrade --check` uses the installation update path", async () => {
    const cli = resolve(import.meta.dir, "../cli.ts");
    const processResult = Bun.spawn([process.execPath, cli, "upgrade", "--check"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VELLOO_INSTALL_METHOD: "direct",
        VELLOO_UPDATE_URL: process.env.VELLOO_UPDATE_URL as string,
        VELLOO_DISABLE_UPDATE_CHECK: "1",
      },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(processResult.stdout).text(),
      new Response(processResult.stderr).text(),
      processResult.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("0.1.0 → 0.2.0 is available (direct installation)");
  });
});
