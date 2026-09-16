import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `scripts/install.sh` against stub archives served over file://. The release
 * smoke test only ever installs into an empty root, which is how an installer
 * that could not upgrade an existing install shipped: it unpacked the new
 * version, left `current` on the old one, and reported success.
 */

const installer = join(dirname(import.meta.dir), "install.sh");

let root: string;
let downloads: string;

function platformTarget(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

function run(command: string[]): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
}

/** A direct-install archive whose launcher prints the version it belongs to. */
async function publish(version: string): Promise<void> {
  const target = platformTarget();
  // musl hosts ask for a `-musl` archive; publish both spellings.
  const names = [`velloo-${version}-${target}.tar.gz`, `velloo-${version}-${target}-musl.tar.gz`];
  const payload = join(root, `payload-${version}`);
  await mkdir(join(payload, "runtime"), { recursive: true });
  await mkdir(join(payload, "bin"), { recursive: true });
  await writeFile(join(payload, "VERSION"), `${version}\n`);
  await writeFile(join(payload, "runtime", "bun"), "#!/bin/sh\n");
  await writeFile(join(payload, "bin", "velloo"), `#!/bin/sh\necho ${version}\n`);
  await chmod(join(payload, "runtime", "bun"), 0o755);
  await chmod(join(payload, "bin", "velloo"), 0o755);
  for (const name of names) {
    const archive = join(downloads, name);
    const packed = run(["tar", "-czf", archive, "-C", payload, "."]);
    if (!packed.success) throw new Error(packed.stderr.toString());
    const hash = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    await writeFile(`${archive}.sha256`, `${hash}  ${name}\n`);
  }
}

interface Install {
  home: string;
  bin: string;
}

async function newInstall(): Promise<Install> {
  const at = await mkdtemp(join(root, "install-"));
  return { home: join(at, "home"), bin: join(at, "bin") };
}

function install(where: Install, version: string): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(["bash", installer], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VELLOO_VERSION: version,
      VELLOO_DOWNLOAD_BASE: `file://${downloads}`,
      VELLOO_HOME: where.home,
      VELLOO_BIN_DIR: where.bin,
    },
  });
}

function installed(where: Install): string {
  return run([join(where.bin, "velloo")])
    .stdout.toString()
    .trim();
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-install-script-"));
  downloads = join(root, "downloads");
  await mkdir(downloads);
  await publish("1.0.0");
  await publish("1.1.0");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("install.sh", () => {
  test("a first install points current at the version", async () => {
    const where = await newInstall();
    const result = install(where, "1.0.0");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await readlink(join(where.home, "current"))).toBe("versions/1.0.0");
    expect(installed(where)).toBe("1.0.0");
  });

  test("an upgrade over an existing install switches current to the new version", async () => {
    const where = await newInstall();
    expect(install(where, "1.0.0").exitCode).toBe(0);
    const result = install(where, "1.1.0");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await readlink(join(where.home, "current"))).toBe("versions/1.1.0");
    expect(installed(where)).toBe("1.1.0");
    // The old installer's symptom: the new link moved inside the old version.
    const leftovers = await readdir(join(where.home, "versions", "1.0.0"));
    expect(leftovers.filter((name) => name.startsWith(".current-"))).toEqual([]);
  });

  test("reinstalling the running version keeps it current", async () => {
    const where = await newInstall();
    expect(install(where, "1.1.0").exitCode).toBe(0);
    const result = install(where, "1.1.0");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await readlink(join(where.home, "current"))).toBe("versions/1.1.0");
    expect(installed(where)).toBe("1.1.0");
  });

  test("an install stranded by the old installer is repaired on the next run", async () => {
    const where = await newInstall();
    expect(install(where, "1.0.0").exitCode).toBe(0);
    const stray = join(where.home, "versions", "1.0.0", ".current-4242");
    run(["ln", "-s", "versions/1.1.0", stray]);

    const result = install(where, "1.1.0");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(installed(where)).toBe("1.1.0");
    expect(await readdir(join(where.home, "versions", "1.0.0"))).not.toContain(".current-4242");
  });
});
