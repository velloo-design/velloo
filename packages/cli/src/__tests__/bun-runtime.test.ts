import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BUN_RUNTIME_FLAGS, selfCommand } from "../bun-runtime.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const cliPath = resolve(import.meta.dir, "../cli.ts");

function nodeModulesAbove(dir: string): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (dirname(at) === at) return false;
  }
}

/** A static site: no `node_modules` in it or above it, so Bun would auto-install. */
function staticHost(): string {
  const root = mkdtempSync(join(tmpdir(), "velloo-static-host-"));
  writeFileSync(join(root, "index.html"), '<link rel="stylesheet" href="style.css"><h1>Hi</h1>');
  writeFileSync(join(root, "style.css"), "h1 { color: teal; }");
  return root;
}

async function run(
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, VELLOO_DISABLE_UPDATE_CHECK: "1", NO_COLOR: "1", ...env },
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("the Bun runtime flags", () => {
  test("ride on every re-spawn of this CLI, ahead of the script", () => {
    expect(selfCommand(["__daemon", "/design"])).toEqual([
      process.execPath,
      ...BUN_RUNTIME_FLAGS,
      Bun.main,
      "__daemon",
      "/design",
    ]);
  });

  test("are the ones the npm launcher starts Bun with", () => {
    // launcher.cjs runs under Node before any of this package is loadable, so
    // it spells the flags out; this is what keeps the two from drifting.
    const launcher = readFileSync(resolve(import.meta.dir, "../../launcher.cjs"), "utf8");
    const flags = BUN_RUNTIME_FLAGS.map((flag) => JSON.stringify(flag)).join(", ");
    expect(launcher).toContain(`spawnSync(runtime, [${flags}, app, ...process.argv.slice(2)]`);
  });

  test("are the ones `bun run velloo` runs the source with", () => {
    const { scripts } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(scripts.velloo).toBe(`bun ${BUN_RUNTIME_FLAGS.join(" ")} packages/cli/src/cli.ts`);
  });

  test.skipIf(nodeModulesAbove(tmpdir()))(
    "stop Bun answering an import from its cache, or fetching one",
    async () => {
      // Without the flags this resolves — after downloading the package.
      const host = staticHost();
      const cache = mkdtempSync(join(tmpdir(), "velloo-bun-cache-"));
      const script =
        'try { console.log(Bun.resolveSync("is-odd/package.json", process.cwd())); } catch { console.log("unresolved"); }';
      const { stdout } = await run([process.execPath, ...BUN_RUNTIME_FLAGS, "-e", script], host, {
        BUN_INSTALL_CACHE_DIR: cache,
      });
      expect(stdout.trim()).toBe("unresolved");
      expect(readdirSync(cache)).toEqual([]);
    },
    60_000,
  );
});

/**
 * The regression this file exists for, at the height a user met it. A plain
 * `bun cli.ts` — no flags, and outside this repo, whose bunfig.toml turns
 * auto-install off — designing for an app that is not a Node project. Bun
 * answered "does this app have Mantine?" by downloading Mantine, and its
 * stylesheet then rode along in every render of the design.
 */
describe("an app with no node_modules", () => {
  test.skipIf(nodeModulesAbove(tmpdir()))(
    "renders without a library it never had, and nothing is fetched",
    async () => {
      const host = staticHost();
      const cache = mkdtempSync(join(tmpdir(), "velloo-bun-cache-"));
      const env = { HOME: join(host, "fake-home"), BUN_INSTALL_CACHE_DIR: cache };
      const init = await run(
        ["bun", cliPath, "init", ".", "--non-interactive", "--no-connect", "--start=sample"],
        host,
        env,
      );
      if (init.code !== 0) throw new Error(`velloo init failed (${init.code}): ${init.stderr}`);
      const screen = readdirSync(join(host, "velloo", "screens"))
        .find((file) => file.endsWith(".json") && !file.includes(".notes."))
        ?.replace(/\.json$/, "");
      if (!screen) throw new Error("the sample scaffolded no screen");

      const out = join(host, "screen.html");
      const render = await run(["bun", cliPath, "render", screen, "--to", out], host, env);
      if (render.code !== 0) throw new Error(`velloo render failed: ${render.stderr}`);
      // A count, not `not.toContain`: a failure would print the whole document.
      expect(readFileSync(out, "utf8").match(/mantine/gi)?.length ?? 0).toBe(0);
      expect(readdirSync(cache)).toEqual([]);
    },
    120_000,
  );
});
