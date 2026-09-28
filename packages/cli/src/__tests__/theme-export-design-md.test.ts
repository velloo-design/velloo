import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Theme } from "@velloo/schema";
import { type ScaffoldedFolder, scaffoldDesignFolder } from "@velloo/server/testing";

/**
 * `velloo theme export --format design-md` end to end: the real command
 * against a scaffolded folder, writing a real file. The emitter has its own
 * unit suite; what this covers is the command surface — the flag, the dry-run
 * default, the guidance pickup, and the two-file dark case.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");
const repoRoot = resolve(import.meta.dir, "../../../..");

let folder: ScaffoldedFolder;
let design: string;
/** The repo the design folder sits in. */
let tmp: string;

const baseTheme: Partial<Theme> = {
  colors: {
    background: "#ffffff",
    foreground: "#111111",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
  },
  spacing: { md: "16px" },
  radius: { md: "0.5rem" },
};

beforeEach(async () => {
  folder = await scaffoldDesignFolder({
    label: "designmd-cli",
    nested: true,
    config: { name: "Acme Web", library: { id: "none" } },
    theme: baseTheme,
  });
  design = folder.root;
  tmp = dirname(design);
});

afterEach(async () => {
  await folder.cleanup();
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

test("reads the design system document it follows, rather than generating prose", async () => {
  // The repo's file, one level above the design folder — read live, never copied.
  await writeFile(
    join(tmp, "DESIGN.md"),
    "# Acme\n\n## Overview\n\nQuiet and precise.\n\n## Colors\n\nOne accent.\n\n## Typography\n\nInter.\n",
    "utf8",
  );
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  expect(await readFile(join(out, "DESIGN.md"), "utf8")).toContain("Quiet and precise.");
  expect(r.stdout).toContain("read from the design system document");
});

test("an edit to that file shows up on the next export, with no re-import", async () => {
  const doc = join(tmp, "DESIGN.md");
  await writeFile(
    doc,
    "# Acme\n\n## Overview\n\nFirst.\n\n## Colors\n\nOne.\n\n## Typography\n\nInter.\n",
    "utf8",
  );
  const out = join(tmp, "app");
  await run(["--to", out, "--format", "design-md", "--apply"]);
  await writeFile(
    doc,
    "# Acme\n\n## Overview\n\nSecond.\n\n## Colors\n\nOne.\n\n## Typography\n\nInter.\n",
    "utf8",
  );
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  expect(await readFile(join(out, "DESIGN.md"), "utf8")).toContain("Second.");
});

test("a dark palette emits a second file and says why", async () => {
  await folder.write("theme/default.json", {
    ...(JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")) as Theme),
    colorsDark: { background: "#000000" },
  });
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--format", "design-md", "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  expect(await readFile(join(out, "DESIGN.dark.md"), "utf8")).toContain('background: "#000000"');
  expect(r.stdout).toContain("no light/dark axis");
});

test("an unknown --format is refused rather than silently ignored", async () => {
  const r = await run(["--to", join(tmp, "app"), "--format", "nope"]);
  expect(r.exitCode).not.toBe(0);
  expect(`${r.stderr}${r.stdout}`).toContain("Expected one of");
});

test("never writes over the document the design follows", async () => {
  const doc = join(tmp, "DESIGN.md");
  const authored =
    "# Acme\n\n## Overview\n\nHand written.\n\n## Colors\n\nOne accent.\n\n## Typography\n\nInter.\n";
  await writeFile(doc, authored, "utf8");
  const r = await run(["--to", tmp, "--format", "design-md", "--apply"]);
  expect(r.exitCode).toBe(0);
  expect(r.stderr).toContain("never writes it");
  expect(await readFile(doc, "utf8")).toBe(authored);
});

test("the default format is unchanged", async () => {
  const out = join(tmp, "app");
  const r = await run(["--to", out, "--apply"]);
  if (r.exitCode !== 0) throw new Error(`export failed: ${r.stderr}${r.stdout}`);
  await expect(readFile(join(out, "DESIGN.md"), "utf8")).rejects.toThrow();
  expect(await readFile(join(out, "tokens.json"), "utf8")).toContain("$value");
});
