import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `velloo theme export --format design-md` end to end: the real command
 * against a scaffolded folder, writing a real file. The emitter has its own
 * unit suite; what this covers is the command surface — the flag, the dry-run
 * default, the guidance pickup, and the two-file dark case.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");
const repoRoot = resolve(import.meta.dir, "../../../..");

let tmp: string;
let design: string;

async function scaffold(theme: Record<string, unknown>): Promise<void> {
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(design, dir), { recursive: true });
  }
  await writeFile(
    join(design, ".design/config.json"),
    JSON.stringify({
      schemaVersion: 4,
      name: "Acme Web",
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    }),
  );
  await writeFile(join(design, "theme/default.json"), JSON.stringify(theme));
}

const baseTheme = {
  name: "default",
  colors: {
    background: "#ffffff",
    foreground: "#111111",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
  },
  typography: {},
  spacing: { md: "16px" },
  radius: { md: "0.5rem" },
};

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-designmd-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  design = join(tmp, "velloo");
  await scaffold(baseTheme);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", cliPath, "theme", "export", ...args, "--design", design], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

test("writes a DESIGN.md named after the design", async () => {
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  const body = await readFile(join(out, "DESIGN.md"), "utf8");
  expect(body.startsWith("---\nversion: alpha\n")).toBe(true);
  expect(body).toContain("name: Acme Web");
  expect(body).toContain('primary: "#4f46e5"');
  expect(body).toContain("## Do's and Don'ts");
});

test("dry run by default — prints a diff and writes nothing", async () => {
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("Would write to:");
  await expect(readFile(join(out, "DESIGN.md"), "utf8")).rejects.toThrow();
});

test("picks up the folder's guidance.md instead of generating prose", async () => {
  await writeFile(join(design, "guidance.md"), "## Overview\n\nQuiet and precise.\n", "utf8");
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  expect(await readFile(join(out, "DESIGN.md"), "utf8")).toContain("Quiet and precise.");
  expect(r.stdout).toContain("came from guidance.md");
});

test("a dark palette emits a second file and says why", async () => {
  await writeFile(
    join(design, "theme/default.json"),
    JSON.stringify({ ...baseTheme, colorsDark: { background: "#000000" } }),
  );
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  expect(await readFile(join(out, "DESIGN.dark.md"), "utf8")).toContain('background: "#000000"');
  expect(r.stdout).toContain("no light/dark axis");
});

test("an unknown --format is refused rather than silently ignored", async () => {
  const r = await run(["--to", join(tmp, "app"), "--format", "nope"]);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('unknown --format "nope"');
});

test("the default format is unchanged", async () => {
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  await expect(readFile(join(out, "DESIGN.md"), "utf8")).rejects.toThrow();
  expect(await readFile(join(out, "tokens.json"), "utf8")).toContain("$value");
});
