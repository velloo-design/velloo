import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existingDesignFolder } from "../folder.ts";
import { unregisterProject } from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

const cliPath = resolve(import.meta.dir, "../cli.ts");
let repo: string;

async function makeDesignFolder(path: string, config: Record<string, unknown> = {}) {
  await mkdir(join(path, ".design"), { recursive: true });
  await mkdir(join(path, "boards"), { recursive: true });
  await mkdir(join(path, "screens"), { recursive: true });
  await writeFile(
    join(path, ".design", "config.json"),
    JSON.stringify({ ...buildDefaultConfig(), ...config }),
    "utf8",
  );
  await writeFile(join(path, "boards", "main.json"), "{}", "utf8");
  await writeFile(join(path, "screens", "home.json"), "{}", "utf8");
}

async function writeManifest(manifest: unknown) {
  await writeFile(join(repo, "velloo.json"), JSON.stringify(manifest, null, 2), "utf8");
}

async function runCli(args: string[]): Promise<{ exitCode: number; out: string }> {
  const proc = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, out: `${stdout}${stderr}` };
}

beforeEach(async () => {
  repo = join(tmpdir(), `velloo-folder-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(repo, ".git"), { recursive: true });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("velloo folder list", () => {
  test("lists every project with its path, board count, and daemon state", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await makeDesignFolder(join(repo, "brand"));
    await writeManifest({ projects: { app: "velloo", brand: "brand" }, defaultProject: "app" });
    const { exitCode, out } = await runCli(["folder"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("2 in");
    expect(out).toContain("app");
    expect(out).toContain("brand");
    expect(out).toContain("1 board");
    expect(out).toContain("stopped");
  });

  test("a registered folder that has gone reads as missing, not as a crash", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await writeManifest({ projects: { app: "velloo", ghost: "gone" } });
    const { exitCode, out } = await runCli(["folder", "list"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("missing");
  });
});

describe("velloo folder remove", () => {
  test("refuses without --yes when there's no terminal to confirm in", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await writeManifest({ projects: { app: "velloo" } });
    const { exitCode, out } = await runCli(["folder", "remove", "app"]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("--yes");
    expect(existsSync(join(repo, "velloo"))).toBe(true);
  });

  test("deletes the folder and drops it from the manifest", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await makeDesignFolder(join(repo, "brand"));
    await writeManifest({ projects: { app: "velloo", brand: "brand" }, defaultProject: "app" });
    const { exitCode, out } = await runCli(["folder", "remove", "brand", "--yes"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("removed");
    expect(existsSync(join(repo, "brand"))).toBe(false);
    expect(existsSync(join(repo, "velloo"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ app: "velloo" });
  });

  test("an unknown project is an error, not a deletion", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await writeManifest({ projects: { app: "velloo" } });
    const { exitCode, out } = await runCli(["folder", "remove", "nope", "--yes"]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("unknown project");
    expect(existsSync(join(repo, "velloo"))).toBe(true);
  });
});

describe("unregisterProject", () => {
  test("clears defaultProject when it named the folder being dropped", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await makeDesignFolder(join(repo, "brand"));
    await writeManifest({ projects: { app: "velloo", brand: "brand" }, defaultProject: "brand" });
    await unregisterProject(join(repo, "brand"), repo);
    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ app: "velloo" });
    expect(manifest.defaultProject).toBeUndefined();
  });

  test("the last project out takes the manifest with it", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await writeManifest({ projects: { app: "velloo" } });
    const result = await unregisterProject(join(repo, "velloo"), repo);
    expect(result.removedManifest).toBe(true);
    expect(existsSync(join(repo, "velloo.json"))).toBe(false);
  });

  test("an unregistered folder is a no-op", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    await writeManifest({ projects: { app: "velloo" } });
    const result = await unregisterProject(join(repo, "elsewhere"), repo);
    expect(result.name).toBeNull();
    expect(existsSync(join(repo, "velloo.json"))).toBe(true);
  });
});

describe("existingDesignFolder", () => {
  test("finds the sibling a new folder should inherit from", async () => {
    await makeDesignFolder(join(repo, "design"));
    await writeManifest({ projects: { app: "design" } });
    expect(await existingDesignFolder(repo)).toBe(join(repo, "design"));
  });

  test("falls back to discovery when there's no manifest yet", async () => {
    await makeDesignFolder(join(repo, "velloo"));
    expect(await existingDesignFolder(repo)).toBe(join(repo, "velloo"));
  });

  test("null when the repo has no design folder at all", async () => {
    expect(await existingDesignFolder(repo)).toBeNull();
  });
});

describe("velloo folder set-app-root", () => {
  beforeEach(async () => {
    await makeDesignFolder(join(repo, "velloo"), { hostApp: { root: ".." } });
    await writeManifest({ projects: { app: "velloo" } });
    await mkdir(join(repo, "packages", "web", "src"), { recursive: true });
    await writeFile(
      join(repo, "packages", "web", "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
  });

  test("previews the change and writes nothing without --yes", async () => {
    const { exitCode, out } = await runCli([
      "folder",
      "set-app-root",
      "velloo",
      "--to",
      "packages/web",
    ]);
    expect(exitCode).toBe(0);
    expect(out).toContain("hostApp.root: .. → ../packages/web");
    expect(out).toContain("Preview only");
    const config = JSON.parse(
      await readFile(join(repo, "velloo", ".design", "config.json"), "utf8"),
    );
    expect(config.hostApp.root).toBe("..");
  });

  test("--yes applies it", async () => {
    const { exitCode, out } = await runCli([
      "folder",
      "set-app-root",
      "velloo",
      "--to",
      "packages/web",
      "--yes",
    ]);
    expect(exitCode).toBe(0);
    expect(out).toContain("application root is now");
    const config = JSON.parse(
      await readFile(join(repo, "velloo", ".design", "config.json"), "utf8"),
    );
    expect(config.hostApp.root).toBe("../packages/web");
  });

  test("a destination that does not exist fails instead of recording it", async () => {
    const { exitCode, out } = await runCli([
      "folder",
      "set-app-root",
      "velloo",
      "--to",
      "packages/nope",
      "--yes",
    ]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("does not exist");
  });
});
