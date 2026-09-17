#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { currentRuntimeTarget } from "./distribution/targets.ts";

const isWindows = process.platform === "win32";
const repoRoot = dirname(dirname(import.meta.path));
const version = (
  await import(join(repoRoot, "packages", "cli", "package.json"), {
    with: { type: "json" },
  })
).default.version as string;
const target = currentRuntimeTarget();
const root = await mkdtemp(join(tmpdir(), "velloo-package-smoke-"));
const prefix = join(root, "prefix");
const node = Bun.which("node");
if (!node) throw new Error("Node is required to smoke-test the npm launcher");
const npm = Bun.which("npm");
if (!npm) throw new Error("npm is required to smoke-test the npm launcher");

// npm lays a global prefix out differently on Windows: shims sit in the prefix
// itself and packages in prefix\node_modules, with no bin/ or lib/.
const command = isWindows ? join(prefix, "velloo.cmd") : join(prefix, "bin", "velloo");
const installed = isWindows
  ? join(prefix, "node_modules", "velloo")
  : join(prefix, "lib", "node_modules", "velloo");

// Only Node and the OS: the package must bring its own Bun.
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const pathWithoutBun = (
  isWindows
    ? [dirname(node), join(systemRoot, "System32"), systemRoot]
    : [dirname(node), "/usr/bin", "/bin"]
).join(delimiter);

// Daemons and local designs are recorded under the home directory. A
// throwaway one keeps a run from touching the machine's real canvases.
const home = join(root, "home");

function run(
  cmd: string[],
  cwd = repoRoot,
  env: Record<string, string | undefined> = process.env,
): Bun.SyncSubprocess<"pipe", "pipe"> {
  return Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", env });
}

function velloo(args: string[], cwd = repoRoot, extraEnv: Record<string, string> = {}) {
  return run([command, ...args], cwd, {
    ...process.env,
    PATH: pathWithoutBun,
    HOME: home,
    USERPROFILE: home,
    VELLOO_DESIGNS_HOME: join(home, "designs"),
    VELLOO_DISABLE_UPDATE_CHECK: "1",
    NO_COLOR: "1",
    ...extraEnv,
  });
}

function expectSuccess(result: Bun.SyncSubprocess<"pipe", "pipe">, what: string): string {
  const stdout = result.stdout.toString();
  if (!result.success) {
    throw new Error(`${what} failed (${result.exitCode})\n${stdout}\n${result.stderr.toString()}`);
  }
  return stdout;
}

let design: string | null = null;
try {
  // Installing Bun's tarball alone does not exercise npm's publish-time
  // package.json normalizer. In particular, npm 11+ strips a bin target that
  // starts with `./` while still exiting successfully. Assert the registry-safe
  // spelling before the registry can accept a package without its CLI.
  const publishManifest = JSON.parse(
    readFileSync(join(repoRoot, "packages", "cli", "dist", "package.json"), "utf8"),
  );
  if (publishManifest.bin?.velloo !== "launcher.cjs") {
    throw new Error('publishable package must declare bin.velloo as "launcher.cjs"');
  }
  if (publishManifest.homepage !== "https://velloo.design") {
    throw new Error('publishable package must link its homepage to "https://velloo.design"');
  }

  await mkdir(home, { recursive: true });
  expectSuccess(
    run([
      npm,
      "install",
      "-g",
      "--prefix",
      prefix,
      "--cache",
      join(root, "npm-cache"),
      "--include=optional",
      "--ignore-scripts",
      existsSync(join(repoRoot, "release-artifacts", `velloo-${version}.tgz`))
        ? join(repoRoot, "release-artifacts", `velloo-${version}.tgz`)
        : join(repoRoot, `velloo-${version}.tgz`),
    ]),
    "npm install",
  );

  const output = expectSuccess(velloo(["--version"]), "velloo --version").trim();
  // A stable build reports the bare version; dev and local append a build
  // stamp in parentheses (see the channel split in packages/cli/build.ts).
  if (output !== version && !output.startsWith(`${version} (`)) {
    throw new Error(`unexpected version output: ${output}`);
  }
  if (!existsSync(join(installed, "BUN-LICENSE.md"))) {
    throw new Error("packaged Bun license notice is missing");
  }
  expectSuccess(
    velloo(["upgrade", "--check"], repoRoot, {
      VELLOO_UPDATE_URL: `data:application/json,${encodeURIComponent(JSON.stringify({ version }))}`,
    }),
    "velloo upgrade --check",
  );

  // What no unit test reaches: a real daemon, started detached by the packaged
  // runtime, serving the built canvas, then stopped.
  const app = join(root, "app");
  await mkdir(app, { recursive: true });
  expectSuccess(
    velloo(["init", app, "--nonInteractive", "--no-connect", "--start=sample"], app),
    "velloo init",
  );
  design = join(app, "velloo");
  const started = expectSuccess(velloo(["run", design, "--background"], app), "velloo run");
  const url = started.match(/canvas at (http:\/\/\S+)/)?.[1];
  if (!url) throw new Error(`velloo run printed no canvas URL:\n${started}`);
  const page = await fetch(url);
  if (!page.ok || !(await page.text()).includes('<div id="root"')) {
    throw new Error(`the canvas at ${url} did not serve the app (${page.status})`);
  }
  const status = expectSuccess(velloo(["status"], app), "velloo status");
  if (!status.includes(url)) throw new Error(`velloo status does not list ${url}:\n${status}`);
  expectSuccess(velloo(["stop", design], app), "velloo stop");
  design = null;
  const after = expectSuccess(velloo(["status"], app), "velloo status after stop");
  if (after.includes(url)) throw new Error(`velloo stop left ${url} running:\n${after}`);

  console.log(
    `✓ npm-global smoke passed for ${target.id} with install scripts disabled and no global Bun on PATH (${output}); a sample canvas started, served, and stopped`,
  );
} finally {
  if (design) velloo(["stop", "--all"]);
  // A daemon that is still exiting can hold its files open on Windows.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(
    (error: unknown) => console.error(`could not remove ${root}: ${String(error)}`),
  );
}
