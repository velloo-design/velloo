import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { existingDesignFolder } from "../design.ts";
import { unregisterDesign } from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

const cliPath = resolve(import.meta.dir, "../cli.ts");
let repo: string;

async function makeDesignFolder(path: string, name: string, config: Record<string, unknown> = {}) {
  await mkdir(join(path, ".design"), { recursive: true });
  await mkdir(join(path, "boards"), { recursive: true });
  await mkdir(join(path, "screens"), { recursive: true });
  await writeFile(
    join(path, ".design", "config.json"),
    JSON.stringify({ ...buildDefaultConfig({ name }), ...config }),
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
  repo = join(tmpdir(), `velloo-design-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(repo, ".git"), { recursive: true });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("velloo design list", () => {
  test("lists every design with its path, board count, and daemon state", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await makeDesignFolder(join(repo, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"], defaultDesign: "app" });
    const { exitCode, out } = await runCli(["design"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("2 in");
    expect(out).toContain("app");
    expect(out).toContain("brand");
    expect(out).toContain("1 board");
    expect(out).toContain("stopped");
  });

  test("a listed folder that has gone reads as missing, not as a crash", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo", "gone"] });
    const { exitCode, out } = await runCli(["design", "list"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("missing");
  });
});

describe("velloo design remove", () => {
  test("refuses without --yes when there's no terminal to confirm in", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["design", "remove", "app"]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("--yes");
    expect(existsSync(join(repo, "velloo"))).toBe(true);
  });

  test("deletes the folder and drops it from the manifest", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await makeDesignFolder(join(repo, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"], defaultDesign: "app" });
    const { exitCode, out } = await runCli(["design", "remove", "brand", "--yes"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("removed");
    expect(existsSync(join(repo, "brand"))).toBe(false);
    expect(existsSync(join(repo, "velloo"))).toBe(true);
    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.designs).toEqual(["velloo"]);
  });

  test("an unknown design is an error, not a deletion", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["design", "remove", "nope", "--yes"]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("unknown design");
    expect(existsSync(join(repo, "velloo"))).toBe(true);
  });
});

describe("unregisterDesign", () => {
  test("clears defaultDesign when it named the folder being dropped", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await makeDesignFolder(join(repo, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"], defaultDesign: "brand" });
    await unregisterDesign(join(repo, "brand"));
    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.designs).toEqual(["velloo"]);
    expect(manifest.defaultDesign).toBeUndefined();
  });

  test("the last design out takes the manifest with it", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const result = await unregisterDesign(join(repo, "velloo"));
    expect(result.removedManifest).toBe(true);
    expect(existsSync(join(repo, "velloo.json"))).toBe(false);
  });

  test("an unregistered folder is a no-op", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const result = await unregisterDesign(join(repo, "elsewhere"));
    expect(result.name).toBeNull();
    expect(existsSync(join(repo, "velloo.json"))).toBe(true);
  });
});

describe("existingDesignFolder", () => {
  test("finds the sibling a new folder should inherit from", async () => {
    await makeDesignFolder(join(repo, "design"), "app");
    await writeManifest({ designs: ["design"] });
    expect(await existingDesignFolder(repo)).toBe(join(repo, "design"));
  });

  test("falls back to discovery when there's no manifest yet", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    expect(await existingDesignFolder(repo)).toBe(join(repo, "velloo"));
  });

  test("null when the repo has no design folder at all", async () => {
    expect(await existingDesignFolder(repo)).toBeNull();
  });
});

describe("velloo design move", () => {
  test("previews the velloo.json path change from the old path to the new one", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["design", "move", "app", "--to", "design"]);
    expect(exitCode, out).toBe(0);
    expect(out).toContain('Design "app": velloo.json path "velloo" → "design"');
    expect(existsSync(join(repo, "velloo"))).toBe(true);
  });
});

describe("velloo design rename", () => {
  test("renames the design and follows defaultDesign", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await makeDesignFolder(join(repo, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"], defaultDesign: "brand" });
    const { exitCode, out } = await runCli(["design", "rename", "brand", "marketing"]);
    expect(exitCode, out).toBe(0);
    const config = JSON.parse(await readFile(join(repo, "brand/.design/config.json"), "utf8"));
    expect(config.name).toBe("marketing");
    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.defaultDesign).toBe("marketing");
  });

  test("a name can have spaces, emoji and any script", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["design", "rename", "app", "🎨 设计 Admin"]);
    expect(exitCode, out).toBe(0);
    const list = await runCli(["design", "list"]);
    expect(list.out).toContain("🎨 设计 Admin");
  });

  test("a name another design has is refused", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await makeDesignFolder(join(repo, "brand"), "brand");
    await writeManifest({ designs: ["velloo", "brand"] });
    const { exitCode, out } = await runCli(["design", "rename", "brand", "app"]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("already exists");
  });
});

describe("velloo folder (hidden alias)", () => {
  test("still runs the design command", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["folder", "list"]);
    expect(exitCode, out).toBe(0);
    expect(out).toContain("app");
  });
});

describe("velloo design upgrade", () => {
  test("migrates the named folder without self-upgrading", async () => {
    await makeDesignFolder(join(repo, "velloo"), "app");
    await writeManifest({ designs: ["velloo"] });
    const { exitCode, out } = await runCli(["design", "upgrade", "app", "--no-skills"]);
    expect(exitCode, out).toBe(0);
    expect(out).toContain("is already at schema version");
    expect(out).not.toContain("self-upgrade");
  });
});

describe("velloo design set-app-root", () => {
  beforeEach(async () => {
    await makeDesignFolder(join(repo, "velloo"), "app", { hostApp: { root: ".." } });
    await writeManifest({ designs: ["velloo"] });
    await mkdir(join(repo, "packages", "web", "src"), { recursive: true });
    await writeFile(
      join(repo, "packages", "web", "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
      "utf8",
    );
  });

  test("previews the change and writes nothing without --yes", async () => {
    const { exitCode, out } = await runCli([
      "design",
      "set-app-root",
      "app",
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
      "design",
      "set-app-root",
      "app",
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
      "design",
      "set-app-root",
      "app",
      "--to",
      "packages/nope",
      "--yes",
    ]);
    expect(exitCode).not.toBe(0);
    expect(out).toContain("does not exist");
  });
});
