import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickDesign } from "@velloo/server";
import { resolveDesign } from "../design.ts";
import {
  chooseDesignName,
  designLabel,
  findDesigns,
  findManifest,
  registerDesign,
  unregisterDesign,
} from "../manifest.ts";
import { buildDefaultConfig } from "../scaffold/default-config.ts";

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function makeDesignFolder(path: string, name: string): Promise<void> {
  await mkdir(join(path, ".design"), { recursive: true });
  await writeFile(
    join(path, ".design", "config.json"),
    JSON.stringify(buildDefaultConfig({ name })),
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
  test("finds velloo.json walking up and resolves design paths", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    const deep = join(tmp, "apps", "web", "src");
    await mkdir(deep, { recursive: true });
    const found = await findManifest(deep);
    expect(found?.dir).toBe(tmp);
    expect(found?.folders).toEqual([join(tmp, "apps/web/velloo")]);
    expect(found?.legacy).toBe(false);
  });

  test("returns null when no manifest exists", async () => {
    expect(await findManifest(tmp)).toBeNull();
  });

  test("malformed JSON fails loud with the manifest path", async () => {
    await writeFile(join(tmp, "velloo.json"), "{ nope", "utf8");
    expect(findManifest(tmp)).rejects.toThrow(join(tmp, "velloo.json"));
  });

  test("invalid shape fails loud (duplicate path, bad defaultDesign)", async () => {
    await writeManifest(tmp, { designs: ["x", "x"] });
    expect(findManifest(tmp)).rejects.toThrow("not a valid velloo manifest");
    await writeManifest(tmp, { designs: ["x"], defaultDesign: "a/b" });
    expect(findManifest(tmp)).rejects.toThrow("defaultDesign");
  });

  test("the pre-designs `projects` map still reads, keeping its names", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" }, defaultProject: "web" });
    const found = await findManifest(tmp);
    expect(found?.legacy).toBe(true);
    expect(found?.manifest.defaultDesign).toBe("web");
    expect(found?.legacyNames.get(join(tmp, "apps/web/velloo"))).toBe("web");
  });
});

describe("findDesigns", () => {
  test("names come from each design's config", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "brand"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "brand"), "marketing");
    const set = await findDesigns(tmp);
    expect(set?.designs.map((d) => d.name)).toEqual(["marketing", "web"]);
  });

  test("a folder not yet upgraded keeps its legacy manifest name", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    await mkdir(join(tmp, "apps/web/velloo/.design"), { recursive: true });
    await writeFile(join(tmp, "apps/web/velloo/.design/config.json"), '{"schemaVersion":3}');
    const set = await findDesigns(tmp);
    expect(set?.byName.get("web")?.root).toBe(join(tmp, "apps/web/velloo"));
  });

  test("a shared name is a conflict, resolvable only by path", async () => {
    await writeManifest(tmp, { designs: ["a", "b"] });
    await makeDesignFolder(join(tmp, "a"), "same");
    await makeDesignFolder(join(tmp, "b"), "same");
    const set = await findDesigns(tmp);
    expect(set?.conflicts.get("same")?.length).toBe(2);
    expect(resolveDesign("same", "run", { cwd: tmp, onFail })).rejects.toThrow(
      /2 designs are named "same"/,
    );
    expect(await resolveDesign("./b", "run", { cwd: tmp, onFail })).toBe(join(tmp, "b"));
  });

  test("an entry outside the repository is flagged and refused", async () => {
    const repo = join(tmp, "repo");
    await mkdir(repo, { recursive: true });
    await writeManifest(repo, { designs: ["../outside"] });
    await makeDesignFolder(join(tmp, "outside"), "outside");
    const set = await findDesigns(repo);
    expect(set?.designs[0]?.outsideRepo).toBe(true);
    expect(resolveDesign("outside", "run", { cwd: repo, onFail })).rejects.toThrow(
      "points outside the repository",
    );
  });
});

describe("designLabel", () => {
  test("a listed design reads as name + repo-root-relative path", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    const folder = join(tmp, "apps/web/velloo");
    await makeDesignFolder(folder, "web");
    expect(await designLabel(folder)).toBe(`web — apps/web/velloo (in ${tmp})`);
  });

  test("null without a manifest, and for a folder the manifest doesn't list", async () => {
    const stray = join(tmp, "stray");
    await makeDesignFolder(stray, "stray");
    expect(await designLabel(stray)).toBeNull();
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    expect(await designLabel(stray)).toBeNull();
  });

  test("a broken manifest degrades to null — display must not fail a listing", async () => {
    await writeFile(join(tmp, "velloo.json"), "{ nope", "utf8");
    const folder = join(tmp, "velloo");
    await makeDesignFolder(folder, "velloo");
    expect(await designLabel(folder)).toBeNull();
  });
});

describe("resolveDesign with a manifest", () => {
  test("requireConfig still suggests design names on a typo'd bare name", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    expect(resolveDesign("wbe", "ci", { cwd: tmp, onFail, requireConfig: true })).rejects.toThrow(
      /unknown design "wbe".*lists: web/,
    );
  });

  test("a design name arg resolves to its folder", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "apps/site/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const folder = await resolveDesign("web", "run", { cwd: tmp, onFail });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("a path arg still resolves as a path", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    const other = join(tmp, "elsewhere/design");
    await makeDesignFolder(other, "other");
    const folder = await resolveDesign("./elsewhere/design", "run", { cwd: tmp, onFail });
    expect(folder).toBe(other);
  });

  test("cwd inside a design folder picks it", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "apps/site/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const inside = join(tmp, "apps/site/velloo/screens");
    await mkdir(inside, { recursive: true });
    const folder = await resolveDesign(undefined, "run", { cwd: inside, onFail });
    expect(folder).toBe(join(tmp, "apps/site/velloo"));
  });

  test("cwd holding exactly one design picks it (monorepo app dir)", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "apps/site/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const folder = await resolveDesign(undefined, "run", {
      cwd: join(tmp, "apps/web"),
      onFail,
    });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("a single design resolves from anywhere in the repo", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    const elsewhere = join(tmp, "tools");
    await mkdir(elsewhere, { recursive: true });
    const folder = await resolveDesign(undefined, "run", { cwd: elsewhere, onFail });
    expect(folder).toBe(join(tmp, "apps/web/velloo"));
  });

  test("defaultDesign breaks a tie at the repo root", async () => {
    await writeManifest(tmp, {
      designs: ["apps/web/velloo", "apps/site/velloo"],
      defaultDesign: "site",
    });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const folder = await resolveDesign(undefined, "run", { cwd: tmp, onFail });
    expect(folder).toBe(join(tmp, "apps/site/velloo"));
  });

  test("ambiguity without a TTY fails listing the designs and the real command", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "apps/site/velloo"] });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    expect(resolveDesign(undefined, "design move", { cwd: tmp, onFail })).rejects.toThrow(
      /several designs: site, web.*velloo design move --id 1` for site/,
    );
  });

  test("a stale manifest entry fails naming the manifest", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    expect(resolveDesign("velloo", "run", { cwd: tmp, onFail })).rejects.toThrow(
      join(tmp, "velloo.json"),
    );
  });

  test("standing inside an unlisted design folder beats the manifest", async () => {
    await writeManifest(tmp, { designs: ["apps/web/velloo", "apps/site/velloo"] });
    const stray = join(tmp, "scratch");
    await makeDesignFolder(stray, "scratch");
    const folder = await resolveDesign(undefined, "run", { cwd: stray, onFail });
    expect(folder).toBe(stray);
  });
});

describe("resolveDesign without a manifest (legacy chain)", () => {
  test("./velloo wins, then the cwd, then walk-up", async () => {
    await makeDesignFolder(join(tmp, "velloo"), "velloo");
    expect(await resolveDesign(undefined, "run", { cwd: tmp, onFail })).toBe(join(tmp, "velloo"));

    // `velloo run /path/to/app` — the arg is the app root, not the design folder.
    expect(await resolveDesign(tmp, "run", { cwd: tmp, onFail, requireConfig: true })).toBe(
      join(tmp, "velloo"),
    );

    const asFolder = join(tmp, "self");
    await makeDesignFolder(asFolder, "self");
    expect(await resolveDesign(undefined, "run", { cwd: asFolder, onFail })).toBe(asFolder);

    const nested = join(asFolder, "screens");
    await mkdir(nested, { recursive: true });
    expect(await resolveDesign(undefined, "run", { cwd: nested, onFail })).toBe(asFolder);
  });

  test("nothing found fails with guidance", async () => {
    expect(resolveDesign(undefined, "run", { cwd: tmp, onFail })).rejects.toThrow(
      "no design folder found",
    );
  });

  test("an explicit path with no design folder fails when required", async () => {
    expect(resolveDesign(tmp, "run", { cwd: tmp, onFail, requireConfig: true })).rejects.toThrow(
      "is not a velloo design folder",
    );
  });
});

describe("chooseDesignName", () => {
  test("a velloo folder nested in an app is named for the app", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const name = await chooseDesignName({
      folder: join(tmp, "apps/web/velloo"),
      appRoot: join(tmp, "apps/web"),
      storage: "repository",
    });
    expect(name).toBe("web");
  });

  test("a velloo folder at the repo root is named velloo, not after the repo", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const name = await chooseDesignName({
      folder: join(tmp, "velloo"),
      appRoot: tmp,
      storage: "repository",
    });
    expect(name).toBe("velloo");
  });

  test("a custom folder is named for itself, wherever the app is", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const name = await chooseDesignName({
      folder: join(tmp, "admin"),
      appRoot: join(tmp, "frontend"),
      storage: "repository",
    });
    expect(name).toBe("admin");
  });

  test("a taken derived name gets a suffix; a taken requested name is refused", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await writeManifest(tmp, { designs: ["apps/web/velloo"] });
    const suffixed = await chooseDesignName({
      folder: join(tmp, "packages/web/velloo"),
      appRoot: join(tmp, "packages/web"),
      storage: "repository",
    });
    expect(suffixed).toBe("web-2");
    expect(
      chooseDesignName({
        folder: join(tmp, "brand"),
        appRoot: tmp,
        storage: "repository",
        requested: "web",
      }),
    ).rejects.toThrow('a design named "web" already exists');
  });

  test("names already on disk count before a manifest exists", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "velloo"), "velloo");
    const name = await chooseDesignName({
      folder: join(tmp, "apps/site/velloo"),
      appRoot: join(tmp, "apps/site"),
      storage: "repository",
    });
    expect(name).toBe("site");
    expect(
      chooseDesignName({
        folder: join(tmp, "x"),
        appRoot: tmp,
        storage: "repository",
        requested: "velloo",
      }),
    ).rejects.toThrow("already exists");
  });

  test("an invalid requested name throws", async () => {
    expect(
      chooseDesignName({
        folder: join(tmp, "velloo"),
        appRoot: tmp,
        storage: "repository",
        requested: "a/b",
      }),
    ).rejects.toThrow("invalid --name");
  });
});

describe("registerDesign", () => {
  test("creates velloo.json at the git root listing the path", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const folder = join(tmp, "apps/web/velloo");
    await makeDesignFolder(folder, "web");
    const reg = await registerDesign(folder, join(tmp, "apps/web"));
    expect(reg).toEqual({ name: "web", path: join(tmp, "velloo.json"), created: true });
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest).toEqual({ designs: ["apps/web/velloo"] });
  });

  test("appends to an existing manifest; re-registering is a no-op", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await registerDesign(join(tmp, "apps/web/velloo"), join(tmp, "apps/web"));
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    await registerDesign(join(tmp, "apps/site/velloo"), join(tmp, "apps/site"));
    const again = await registerDesign(join(tmp, "apps/web/velloo"), join(tmp, "apps/web"));
    expect(again).toMatchObject({ name: "web", created: false });
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest.designs).toEqual(["apps/web/velloo", "apps/site/velloo"]);
  });

  test("a name another design already has is refused", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "a"), "same");
    await registerDesign(join(tmp, "a"), tmp);
    await makeDesignFolder(join(tmp, "b"), "same");
    expect(registerDesign(join(tmp, "b"), tmp)).rejects.toThrow('"same" already exists');
  });

  test("creating the manifest adopts design folders already in the repo", async () => {
    // The bug this guards: a repo with `velloo/` gains a second folder, and
    // the new manifest lists only the second — shadowing the original, which
    // then disappears from every command that resolves through the manifest.
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "velloo"), "velloo");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const second = join(tmp, "initial-board");
    await makeDesignFolder(second, "initial-board");

    const reg = await registerDesign(second, tmp);
    expect(reg.created).toBe(true);
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect([...manifest.designs].sort()).toEqual(["apps/site/velloo", "initial-board", "velloo"]);
    // The conventional folder keeps being what a bare command resolves to.
    expect(manifest.defaultDesign).toBe("velloo");
    expect(await resolveDesign(undefined, "run", { cwd: tmp, onFail })).toBe(join(tmp, "velloo"));
  });

  test("node_modules and dist are never scanned for adoption", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    await makeDesignFolder(join(tmp, "node_modules/pkg/velloo"), "pkg");
    await makeDesignFolder(join(tmp, "dist/velloo"), "dist");
    await makeDesignFolder(join(tmp, "design"), "design");
    await registerDesign(join(tmp, "design"), tmp);
    const manifest = JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"));
    expect(manifest.designs).toEqual(["design"]);
  });

  test("an existing manifest above the folder wins over the git root", async () => {
    await mkdir(join(tmp, ".git"), { recursive: true });
    const appsDir = join(tmp, "apps");
    await mkdir(appsDir, { recursive: true });
    await writeManifest(appsDir, { designs: ["web/velloo"] });
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const reg = await registerDesign(join(tmp, "apps/site/velloo"), join(tmp, "apps/site"));
    expect(reg.path).toBe(join(appsDir, "velloo.json"));
    const manifest = JSON.parse(await readFile(join(appsDir, "velloo.json"), "utf8"));
    expect(manifest.designs).toEqual(["web/velloo", "site/velloo"]);
  });

  test("a pre-designs manifest is refused until upgraded", async () => {
    await writeManifest(tmp, { projects: { web: "apps/web/velloo" } });
    await makeDesignFolder(join(tmp, "brand"), "brand");
    expect(registerDesign(join(tmp, "brand"), tmp)).rejects.toThrow("velloo upgrade");
  });
});

describe("unregisterDesign", () => {
  test("drops the path and a defaultDesign naming it; the last one removes the file", async () => {
    await makeDesignFolder(join(tmp, "a"), "a");
    await makeDesignFolder(join(tmp, "b"), "b");
    await writeManifest(tmp, { designs: ["a", "b"], defaultDesign: "a" });
    const first = await unregisterDesign(join(tmp, "a"), tmp);
    expect(first).toMatchObject({ name: "a", removedManifest: false });
    expect(JSON.parse(await readFile(join(tmp, "velloo.json"), "utf8"))).toEqual({
      designs: ["b"],
    });
    const last = await unregisterDesign(join(tmp, "b"), tmp);
    expect(last.removedManifest).toBe(true);
  });
});

describe("pickDesign", () => {
  test("containment beats defaultDesign; with neither the pick is arbitrary", async () => {
    await writeManifest(tmp, {
      designs: ["apps/web/velloo", "apps/site/velloo"],
      defaultDesign: "web",
    });
    await makeDesignFolder(join(tmp, "apps/web/velloo"), "web");
    await makeDesignFolder(join(tmp, "apps/site/velloo"), "site");
    const found = await findDesigns(tmp);
    if (!found) throw new Error("manifest not found");
    expect(pickDesign(found, join(tmp, "apps/site/velloo/screens"))).toMatchObject({
      design: { name: "site" },
      reason: "cwd",
    });
    expect(pickDesign(found, tmp)).toMatchObject({ design: { name: "web" }, reason: "default" });
    expect(pickDesign({ ...found, defaultDesign: undefined }, tmp)).toMatchObject({
      design: { name: "site" },
      reason: "arbitrary",
    });
  });
});
