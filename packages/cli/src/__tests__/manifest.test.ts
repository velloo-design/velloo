import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDesignFolder } from "../folder.ts";
import { findManifest, pickProject, projectLabel, registerProject } from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function makeDesignFolder(path: string): Promise<void> {
  await mkdir(join(path, ".design"), { recursive: true });
  // The legacy walk-up parses the config against ConfigSchema, so the
  // fixture needs a real one, not a stub.
  await writeFile(
    join(path, ".design", "config.json"),
    JSON.stringify(buildDefaultConfig()),
    "utf8",
  );
}

async function writeManifest(dir: string, manifest: unknown): Promise<string> {
  const path = join(dir, "velloo.json");
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  return path;
}

/** Capture the failure message instead of exiting the test process. */
const onFail = (message: string): never => {
  throw new Error(message);
};

describe("findManifest", () => {
  test("finds velloo.json walking up and resolves project paths", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    const deep = join(tmp, "apps", "web", "src");
    await mkdir(deep, { recursive: true });
    const found = await findManifest(deep);
    expect(found?.dir).toBe(tmp);
    expect(found?.folders.get("web")).toBe(join(tmp, "apps/web/velloo"));
  });

  test("returns null when no manifest exists", async () => {
    expect(await findManifest(tmp)).toBeNull();
  });

  test("malformed JSON fails loud with the manifest path", async () => {
    await writeFile(join(tmp, "velloo.json"), "{ nope", "utf8");
    expect(findManifest(tmp)).rejects.toThrow(join(tmp, "velloo.json"));
  });

  test("invalid shape fails loud (bad project name, dangling defaultProject)", async () => {
    await writeManifest(tmp, { projects: { "bad name!": "x" } });
    expect(findManifest(tmp)).rejects.toThrow("not a valid velloo manifest");
    await writeManifest(tmp, { projects: { web: "x" }, defaultProject: "ghost" });
    expect(findManifest(tmp)).rejects.toThrow("defaultProject");
  });
});

describe("projectLabel", () => {
  test("a registered folder reads as project + repo-root-relative path", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    const folder = join(tmp, "apps/web/velloo");
    await makeDesignFolder(folder);
    expect(await projectLabel(folder)).toBe(`web — apps/web/velloo (in ${tmp})`);
  });

  test("null without a manifest, and for a folder the manifest doesn't list", async () => {
    const stray = join(tmp, "stray");
    await makeDesignFolder(stray);
    expect(await projectLabel(stray)).toBeNull();
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    expect(await projectLabel(stray)).toBeNull();
  });

  test("a broken manifest degrades to null — display must not fail a listing", async () => {
    await writeFile(join(tmp, "velloo.json"), "{ nope", "utf8");
    const folder = join(tmp, "velloo");
    await makeDesignFolder(folder);
    expect(await projectLabel(folder)).toBeNull();
  });
});

describe("resolveDesignFolder with a manifest", () => {
  test("requireConfig still suggests project names on a typo'd bare name", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    expect(
      resolveDesignFolder("wbe", "ci", { cwd: tmp, onFail, requireConfig: true }),
    ).rejects.toThrow(/unknown project "wbe".*lists: web/);
  });

  test("a project name arg resolves to its folder", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo", site: "apps/site/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    const folder = await resolveDesignFolder("web", "run", { cwd: tmp, onFail });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("an unknown bare name lists the available projects", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    expect(resolveDesignFolder("wbe", "run", { cwd: tmp, onFail })).rejects.toThrow(
      'unknown project "wbe"',
    );
  });

  test("a path arg still resolves as a path", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    const other = join(tmp, "elsewhere/design");
    await makeDesignFolder(other);
    const folder = await resolveDesignFolder("./elsewhere/design", "run", { cwd: tmp, onFail });
    expect(folder).toBe(other);
  });

  test("cwd inside a project folder picks it", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo", site: "apps/site/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"));
    const inside = join(tmp, "apps/site/velloo/screens");
    await mkdir(inside, { recursive: true });
    const folder = await resolveDesignFolder(undefined, "run", { cwd: inside, onFail });
    expect(folder).toBe(join(tmp, "apps/site/velloo"));
  });

  test("cwd holding exactly one project picks it (monorepo app dir)", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo", site: "apps/site/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"));
    const folder = await resolveDesignFolder(undefined, "run", {
      cwd: join(tmp, "apps/web"),
      onFail,
    });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("a single project resolves from anywhere in the repo", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    const elsewhere = join(tmp, "tools");
    await mkdir(elsewhere, { recursive: true });
    const folder = await resolveDesignFolder(undefined, "run", { cwd: elsewhere, onFail });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("defaultProject breaks a tie at the repo root", async () => {
    await writeManifest(tmp, {
      projects: { web: "apps/web/velloo", site: "apps/site/velloo" },
      defaultProject: "site",
    });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"));
    const folder = await resolveDesignFolder(undefined, "run", { cwd: tmp, onFail });
    expect(folder).toBe(join(tmp, "apps/site/velloo"));
  });

  test("ambiguity without a TTY fails listing the projects", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo", site: "apps/site/velloo" } });
    await makeDesignFolder(join(tmp, "apps/web/velloo"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"));
    expect(resolveDesignFolder(undefined, "run", { cwd: tmp, onFail })).rejects.toThrow(
      "several projects",
    );
  });

  test("a stale manifest entry fails naming the manifest", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    expect(resolveDesignFolder("web", "run", { cwd: tmp, onFail })).rejects.toThrow(
      join(tmp, "velloo.json"),
    );
  });

  test("standing inside an unlisted design folder beats the manifest", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo", site: "apps/site/velloo" } });
    const stray = join(tmp, "scratch");
    await makeDesignFolder(stray);
    const folder = await resolveDesignFolder(undefined, "run", { cwd: stray, onFail });
    expect(folder).toBe(stray);
  });
});

describe("resolveDesignFolder without a manifest (legacy chain)", () => {
  test("./velloo wins, then the cwd, then walk-up", async () => {
    await makeDesignFolder(join(tmp, "velloo"));
    expect(await resolveDesignFolder(undefined, "run", { cwd: tmp, onFail })).toBe(
      join(tmp, "velloo"),
    );

    // `velloo run /path/to/app` — the arg is the app root, not the design folder.
    expect(await resolveDesignFolder(tmp, "run", { cwd: tmp, onFail, requireConfig: true })).toBe(
      join(tmp, "velloo"),
    );

    const asFolder = join(tmp, "self");
    await makeDesignFolder(asFolder);
    expect(await resolveDesignFolder(undefined, "run", { cwd: asFolder, onFail })).toBe(asFolder);

    const nested = join(asFolder, "screens");
    await mkdir(nested, { recursive: true });
    expect(await resolveDesignFolder(undefined, "run", { cwd: nested, onFail })).toBe(asFolder);
  });

  test("nothing found fails with guidance", async () => {
    expect(resolveDesignFolder(undefined, "run", { cwd: tmp, onFail })).rejects.toThrow(
      "no design folder found",
    );
  });

  test("an explicit path with no design folder fails when required", async () => {
    expect(
      resolveDesignFolder(tmp, "run", { cwd: tmp, onFail, requireConfig: true }),
    ).rejects.toThrow("is not a velloo design folder");
  });
});

describe("registerProject", () => {
  test("creates velloo.json at the git root with a derived name", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const folder = join(tmp, "apps/web/velloo");
    await makeDesignFolder(folder);
    const reg = await registerProject(folder, join(tmp, "apps/web"));
    expect(reg).toEqual({ name: "web", path: join(tmp, "velloo.json"), created: true });
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ web: "apps/web/velloo" });
  });

  test("merges a second project and is idempotent for a registered folder", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await registerProject(join(tmp, "apps/web/velloo"), join(tmp, "apps/web"));
    await registerProject(join(tmp, "apps/site/velloo"), join(tmp, "apps/site"));
    const again = await registerProject(join(tmp, "apps/web/velloo"), join(tmp, "apps/web"));
    expect(again.created).toBe(false);
    expect(again.name).toBe("web");
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ web: "apps/web/velloo", site: "apps/site/velloo" });
  });

  test("suffixes a name collision pointing at a different path", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await registerProject(join(tmp, "apps/web/velloo"), join(tmp, "apps/web"));
    const reg = await registerProject(join(tmp, "packages/web/velloo"), join(tmp, "packages/web"));
    expect(reg.name).toBe("web-2");
  });

  test("no git root lands the manifest at the app root; --project overrides the name", async () => {
    const appRoot = join(tmp, "standalone");
    const folder = join(appRoot, "velloo");
    await makeDesignFolder(folder);
    const reg = await registerProject(folder, appRoot, "brand");
    expect(reg).toEqual({ name: "brand", path: join(appRoot, "velloo.json"), created: true });
    const manifest = JSON.parse(await readFile(join(appRoot, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ brand: "velloo" });
  });

  test("creating the manifest adopts design folders already in the repo", async () => {
    // The bug this guards: a repo with `velloo/` gains a second folder, and
    // the new manifest names only the second — shadowing the original, which
    // then disappears from every command that resolves through the manifest.
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "velloo"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"));
    const second = join(tmp, "initial-board");
    await makeDesignFolder(second);

    const reg = await registerProject(second, tmp);
    expect(reg.created).toBe(true);
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    // `<root>/velloo` derives its name from the repo directory, so match on
    // the target rather than the generated tmp name.
    const targets = Object.values(manifest.projects) as string[];
    expect(targets.sort()).toEqual(["apps/site/velloo", "initial-board", "velloo"]);
    // The conventional folder keeps being what a bare command resolves to.
    expect(manifest.projects[manifest.defaultProject]).toBe("velloo");
    expect(await resolveDesignFolder(undefined, "run", { cwd: tmp, onFail })).toBe(
      join(tmp, "velloo"),
    );
  });

  test("adoption only happens on creation — a later register just merges", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    await makeDesignFolder(join(tmp, "velloo"));
    await registerProject(join(tmp, "apps/site/velloo"), join(tmp, "apps/site"));
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ web: "apps/web/velloo", site: "apps/site/velloo" });
    expect(manifest.defaultProject).toBeUndefined();
  });

  test("node_modules and dist are never scanned for adoption", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "node_modules/pkg/velloo"));
    await makeDesignFolder(join(tmp, "dist/velloo"));
    await registerProject(join(tmp, "design"), tmp);
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(Object.keys(manifest.projects)).toEqual(["design"]);
  });

  test("an invalid requested name throws", async () => {
    expect(registerProject(join(tmp, "velloo"), tmp, "bad name!")).rejects.toThrow(
      "invalid --project",
    );
  });

  test("an existing manifest above the folder wins over the git root", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const appsDir = join(tmp, "apps");
    await mkdir(appsDir, { recursive: true });
    await writeManifest(appsDir, { projects: { web: "web/velloo" } });
    const reg = await registerProject(join(tmp, "apps/site/velloo"), join(tmp, "apps/site"));
    expect(reg.path).toBe(join(appsDir, "velloo.json"));
    const manifest = JSON.parse(await readFile(join(appsDir, "velloo.json"), "utf8"));
    expect(manifest.projects).toEqual({ web: "web/velloo", site: "site/velloo" });
  });
});

describe("pickProject", () => {
  test("containment beats defaultProject", async () => {
    await writeManifest(tmp, {
      projects: { web: "apps/web/velloo", site: "apps/site/velloo" },
      defaultProject: "web",
    });
    const found = await findManifest(tmp);
    if (!found) throw new Error("manifest not found");
    expect(pickProject(found, join(tmp, "apps/site/velloo/screens"))).toBe("site");
    expect(pickProject(found, tmp)).toBe("web");
  });
});
