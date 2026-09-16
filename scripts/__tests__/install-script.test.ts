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
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

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

/**
 * The system directories the installer's own tools (curl, tar, shasum) live
 * in, and nothing else: the developer's PATH may carry a real velloo, which
 * would show up in every diagnostic.
 */
const TOOLS_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

function install(
  where: Install,
  version: string,
  opts: { path?: string; shell?: string } = {},
): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(["bash", installer], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOME: process.env.HOME ?? root,
      PATH: opts.path ?? `${where.bin}:${TOOLS_PATH}`,
      SHELL: opts.shell ?? "/bin/zsh",
      VELLOO_VERSION: version,
      VELLOO_DOWNLOAD_BASE: `file://${downloads}`,
      VELLOO_HOME: where.home,
      VELLOO_BIN_DIR: where.bin,
    },
  });
}

/** Installer output without its colour escapes. */
const text = (result: Bun.SyncSubprocess<"pipe", "pipe">): string =>
  stripVTControlCharacters(result.stdout.toString());

/** A bin dir holding a `velloo` linked the way npm links a global install. */
async function npmGlobal(): Promise<string> {
  const prefix = await mkdtemp(join(root, "npm-"));
  const pkg = join(prefix, "lib", "node_modules", "velloo");
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "launcher.cjs"), "#!/bin/sh\necho npm\n");
  await chmod(join(pkg, "launcher.cjs"), 0o755);
  await mkdir(join(prefix, "bin"));
  await symlink("../lib/node_modules/velloo/launcher.cjs", join(prefix, "bin", "velloo"));
  return join(prefix, "bin");
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

describe("install.sh PATH diagnostics", () => {
  test("says where it installed, and nothing more when PATH already runs it", async () => {
    const where = await newInstall();
    const result = install(where, "1.0.0");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const out = text(result);
    expect(out).toContain(`installed in  ${join(where.home, "versions", "1.0.0")}`);
    expect(out).toContain(`command       ${join(where.bin, "velloo")}`);
    expect(out).not.toContain("!");
    expect(out).not.toContain("hash -r");
  });

  test("a bin dir missing from PATH gets the line for the user's shell", async () => {
    const where = await newInstall();
    const zsh = text(install(where, "1.0.0", { path: TOOLS_PATH, shell: "/bin/zsh" }));
    expect(zsh).toContain(`${where.bin} is not on your PATH`);
    expect(zsh).toContain(`echo 'export PATH="${where.bin}:$PATH"' >> ~/.zshrc`);

    const fish = text(install(where, "1.0.0", { path: TOOLS_PATH, shell: "/usr/bin/fish" }));
    expect(fish).toContain(`fish_add_path ${where.bin}`);
  });

  test("names a velloo earlier on PATH, where it came from, and how to remove it", async () => {
    const where = await newInstall();
    const npmBin = await npmGlobal();
    const result = install(where, "1.0.0", { path: `${npmBin}:${where.bin}:${TOOLS_PATH}` });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const out = text(result);
    expect(out).toContain("Another velloo comes before");
    expect(out).toContain(join(npmBin, "velloo"));
    expect(out).toContain("npm uninstall -g velloo");
  });

  test("an older install later on PATH gets the cached-location hint instead", async () => {
    const where = await newInstall();
    const npmBin = await npmGlobal();
    const out = text(install(where, "1.0.0", { path: `${where.bin}:${npmBin}:${TOOLS_PATH}` }));
    expect(out).not.toContain("comes before");
    expect(out).toContain("after this one");
    expect(out).toContain("hash -r");
  });

  test("a velloo on PATH while the bin dir isn't: both are reported", async () => {
    const where = await newInstall();
    const npmBin = await npmGlobal();
    const out = text(install(where, "1.0.0", { path: `${npmBin}:${TOOLS_PATH}` }));
    expect(out).toContain("is not on your PATH");
    expect(out).toContain("Until then `velloo` runs another install:");
    expect(out).toContain(join(npmBin, "velloo"));
  });
});
