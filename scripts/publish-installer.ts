#!/usr/bin/env bun
/**
 * Replace only `install.sh` on a download host, pinned to the version that
 * host already serves — an installer fix without cutting a release:
 *
 *   bun scripts/publish-installer.ts prod   # → get.velloo.design
 *   bun scripts/publish-installer.ts dev    # → get.dev.velloo.design
 *
 * `velloo upgrade` on a curl install fetches the host's installer each time,
 * so this also repairs how every existing direct install upgrades. Runs in CI
 * (installer.yml) with the environment's BLOB_* secrets, like publish-cli.ts.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOWNLOAD_HOSTS,
  downloadBucket,
  downloadEnvironment,
  installerForHost,
  renderInstaller,
} from "./distribution/downloads.ts";
import { RUNTIME_TARGETS } from "./distribution/targets.ts";

const TIMEOUT_MS = 15_000;
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

async function main(): Promise<void> {
  const host = DOWNLOAD_HOSTS[downloadEnvironment(process.argv[2])];
  const base = `https://${host}`;

  const latest = await fetch(`${base}/latest.json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!latest.ok) throw new Error(`${base}/latest.json returned HTTP ${latest.status}`);
  const { version } = (await latest.json()) as { version?: unknown };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${base}/latest.json has no usable version`);
  }

  // The installer names an archive per platform; one that isn't there would
  // turn a working installer into a 404 for that platform.
  const archives = RUNTIME_TARGETS.filter((target) => target.os !== "win32").flatMap((target) => {
    const name = `velloo-${version}-${target.id}.tar.gz`;
    return [name, `${name}.sha256`];
  });
  const missing: string[] = [];
  for (const name of archives) {
    const probe = await fetch(`${base}/${name}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!probe.ok) missing.push(`${name} (HTTP ${probe.status})`);
  }
  if (missing.length > 0) {
    throw new Error(`${host} is missing archives for ${version}:\n  ${missing.join("\n  ")}`);
  }

  const installer = installerForHost(renderInstaller(version, base), host);
  const scratch = await mkdtemp(join(tmpdir(), "velloo-installer-"));
  try {
    const path = join(scratch, "install.sh");
    await writeFile(path, installer);
    const syntax = Bun.spawnSync(["bash", "-n", path], { stderr: "pipe" });
    if (!syntax.success) throw new Error(`rendered installer: ${syntax.stderr.toString()}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const { client, bucket } = downloadBucket();
  console.log(
    `\x1b[36m▸\x1b[0m publishing install.sh for velloo ${version} to ${bucket}/downloads/ (${host})…`,
  );
  await client.write("downloads/install.sh", installer);

  // The host ignores the query string, so this skips any cache in front of it.
  const served = await fetch(`${base}/install.sh?published=${Date.now()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = served.ok ? await served.text() : "";
  if (sha256(body) !== sha256(installer)) {
    throw new Error(`${base}/install.sh does not serve the installer just uploaded`);
  }
  console.log(`\x1b[32m✓ ${base}/install.sh now installs velloo ${version}\x1b[0m`);
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
