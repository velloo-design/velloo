import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "@velloo/schema";

/**
 * End-to-end CLI smoke: run `velloo init` as a subprocess into a tmp
 * folder and confirm the scaffold matches every schema we ship. This
 * is the only test that exercises the full CLI surface; if it breaks,
 * onboarding is broken.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runInit(folder: string) {
  const proc = Bun.spawn(["bun", cliPath, "init", folder], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("velloo init", () => {
  test("scaffolds a folder whose contents parse against every schema", async () => {
    const { exitCode, stdout, stderr } = await runInit(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("scaffolded");
    if (exitCode !== 0) {
      // Surface stderr so a CI failure is debuggable.
      throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    }

    // .design/config.json
    const configRaw = await readFile(join(tmp, ".design/config.json"), "utf8");
    const config = ConfigSchema.parse(JSON.parse(configRaw));
    expect(config.library.id).toBe("shadcn-react");
    expect(config.defaultBoard).toBeDefined();
    expect(config.defaultScreen).toBeDefined();

    // theme/default.json
    const themeRaw = await readFile(join(tmp, "theme/default.json"), "utf8");
    const theme = ThemeSchema.parse(JSON.parse(themeRaw));
    expect(theme.name).toBeDefined();

    // screens/*.json — every file is a valid Screen
    const screenFiles = (await readdir(join(tmp, "screens"))).filter((f) => f.endsWith(".json"));
    expect(screenFiles.length).toBeGreaterThan(0);
    for (const f of screenFiles) {
      const raw = await readFile(join(tmp, "screens", f), "utf8");
      ScreenSchema.parse(JSON.parse(raw));
    }

    // boards/*.json
    const boardFiles = (await readdir(join(tmp, "boards"))).filter((f) => f.endsWith(".json"));
    expect(boardFiles.length).toBeGreaterThan(0);
    for (const f of boardFiles) {
      const raw = await readFile(join(tmp, "boards", f), "utf8");
      BoardSchema.parse(JSON.parse(raw));
    }

    // snippets/*.json
    const snippetFiles = (await readdir(join(tmp, "snippets"))).filter((f) => f.endsWith(".json"));
    expect(snippetFiles.length).toBeGreaterThan(0);
    for (const f of snippetFiles) {
      const raw = await readFile(join(tmp, "snippets", f), "utf8");
      SnippetSchema.parse(JSON.parse(raw));
    }
  }, 30_000);

  test("refuses to scaffold over a non-empty folder without --force", async () => {
    await Bun.write(join(tmp, "marker.txt"), "stay");
    const { exitCode, stderr } = await runInit(tmp);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not empty");
  }, 30_000);
});
