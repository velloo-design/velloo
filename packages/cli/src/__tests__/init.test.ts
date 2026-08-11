import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, PageSchema, ThemeSchema } from "@velloo/schema";

const CLI = join(import.meta.dir, "..", "cli.ts");

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "velloo-init-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runInit(
  folder: string,
  ...flags: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI, "init", folder, ...flags], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("velloo init", () => {
  test("scaffolds a valid design folder", async () => {
    const target = join(tmp, "design");
    const { exitCode, stdout } = await runInit(target);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("scaffolded design folder");

    const config = await readJson(join(target, ".design/config.json"));
    const theme = await readJson(join(target, "theme/default.json"));
    const welcome = await readJson(join(target, "pages/welcome.json"));
    const settings = await readJson(join(target, "pages/settings.json"));

    expect(ConfigSchema.parse(config)).toBeDefined();
    expect(ThemeSchema.parse(theme)).toBeDefined();
    const parsedWelcome = PageSchema.parse(welcome);
    expect(parsedWelcome.variants.map((v) => v.id)).toEqual(["mobile", "desktop"]);
    const parsedSettings = PageSchema.parse(settings);
    expect(parsedSettings.name).toBe("Settings");
  });

  test("refuses a non-empty target without --force", async () => {
    await Bun.write(join(tmp, "existing.txt"), "hi");
    const { exitCode, stderr } = await runInit(tmp);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not empty");
  });

  test("--force allows scaffolding into a non-empty folder", async () => {
    await Bun.write(join(tmp, "existing.txt"), "hi");
    const { exitCode } = await runInit(tmp, "--force");
    expect(exitCode).toBe(0);

    const config = await readJson(join(tmp, ".design/config.json"));
    expect(ConfigSchema.parse(config)).toBeDefined();
    // Both pages should be on disk.
    const welcome = await readJson(join(tmp, "pages/welcome.json"));
    const settings = await readJson(join(tmp, "pages/settings.json"));
    expect(PageSchema.parse(welcome)).toBeDefined();
    expect(PageSchema.parse(settings)).toBeDefined();
  });
});
