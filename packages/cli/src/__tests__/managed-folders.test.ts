import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { RepoManifestSchema } from "@velloo/schema";
import {
  hostAppRootFrom,
  loadDesignFolder,
  managedDesignPath,
  managedProjectContext,
  readRepoFeedback,
  resolveProjectPath,
  writeRepoFeedback,
} from "@velloo/server";
import { createRevertRouter } from "../../../server/src/routes/revert.ts";
import { connect } from "../connect/index.ts";
import { resolveProjectRoot } from "../connect/project-root.ts";
import { resolveDesignFolder, resolveDesignLocation } from "../folder.ts";
import { checkpoint, planRelocation, relocateDesign } from "../managed-folders.ts";
import { findManifest, projectLabel } from "../manifest.ts";
import { gitContext } from "../publish/core.ts";

const cli = resolve(import.meta.dir, "../cli.ts");

// Every case spawns the real CLI, and some of them a headless browser through
// it. Under `bun test --parallel` those queue behind every other worker's, and
// the 5s default starts tripping.
setDefaultTimeout(30_000);

let root: string;
let app: string;
let previousHome: string | undefined;
const onFail = (message: string): never => {
  throw new Error(message);
};

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "velloo-managed-")));
  app = join(root, "application", "repo");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "package.json"), '{"name":"host-app"}');
  previousHome = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = join(root, "user-data", "designs");
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.VELLOO_DESIGNS_HOME;
  else process.env.VELLOO_DESIGNS_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});

async function command(args: string[], cwd = app, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd,
    env: {
      ...process.env,
      VELLOO_DAEMONS_PATH: join(root, "daemons.json"),
      VELLOO_PREFS_PATH: join(root, "prefs.json"),
      VELLOO_CREDENTIALS_PATH: join(root, "credentials.json"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out: out + error };
}

async function init(external = true) {
  const result = await command([
    "init",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=sample",
    "--project=web",
    ...(external ? ["--external"] : []),
  ]);
  expect(result.code, result.out).toBe(0);
  return resolveDesignFolder("web", "test", { cwd: app, onFail });
}

function git(folder: string, ...args: string[]) {
  return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" }).trim();
}

test("external init creates portable locator, a validated initial commit, and both roots", async () => {
  const folder = await init();
  const manifest = await findManifest(app);
  if (!manifest) throw new Error("Missing test manifest");
  const entry = manifest.manifest.projects.web;
  expect(typeof entry).toBe("object");
  expect(JSON.stringify(manifest.manifest)).not.toContain(root);
  expect(folder.startsWith(app)).toBe(false);
  expect(await resolveDesignLocation(undefined, "test", { cwd: app, onFail })).toMatchObject({
    designRoot: folder,
    appRoot: app,
    manifestPath: join(app, "velloo.json"),
    projectName: "web",
  });
  expect(await resolveDesignFolder(app, "test", { cwd: root, onFail })).toBe(folder);
  expect(await resolveProjectRoot(folder)).toBe(app);
  const design = await loadDesignFolder(folder);
  expect(hostAppRootFrom(folder, design.config.hostApp)).toBe(app);
  expect(design.config.hostApp?.root).toBe("project:.");
  expect(git(folder, "rev-parse", "--show-toplevel")).toBe(folder);
  expect(git(folder, "status", "--porcelain")).toBe("");
  expect(git(folder, "log", "-1", "--format=%s")).toBe("Initial Velloo design");
  expect(gitContext(folder).repo).toBeNull();
  expect(await projectLabel(folder)).toContain("web");
});

test("host references and feedback follow the originating application manifest", async () => {
  const folder = await init();
  await mkdir(join(app, "apps/admin"), { recursive: true });
  expect(resolveProjectPath(folder, "project:apps\\admin")).toBe(join(app, "apps/admin"));
  expect(hostAppRootFrom(folder, { root: "project:apps/admin" })).toBe(join(app, "apps/admin"));
  await writeRepoFeedback(folder, { enabled: true, contactOk: true });
  expect(await readRepoFeedback(folder)).toEqual({ enabled: true });
  expect((await loadDesignFolder(folder)).config.feedback?.enabled).toBe(true);
  expect(await readFile(join(app, "velloo.json"), "utf8")).not.toContain("contactOk");
});

test("agent configs and guidance use the project name in the application checkout", async () => {
  const folder = await init();
  const result = await connect({
    designFolder: folder,
    agents: ["cursor"],
    installSkill: true,
    homeDir: join(root, "home"),
  });
  expect(result.projectRoot).toBe(app);
  const config = JSON.parse(await readFile(join(app, ".cursor/mcp.json"), "utf8"));
  expect(config.mcpServers.velloo.args).toEqual(["mcp", "web"]);
  const guidance = await readFile(join(app, ".cursor/rules/velloo.mdc"), "utf8");
  expect(guidance).toContain("velloo run web");
  expect(guidance).not.toContain(root);
});

test("a clone cannot claim an existing local binding until explicitly rebound", async () => {
  const folder = await init();
  const clone = join(root, "clone");
  await cp(app, clone, { recursive: true });
  await expect(resolveDesignFolder("web", "test", { cwd: clone, onFail })).rejects.toThrow(
    "bound to another application",
  );
  const result = await command(["folder", "bind", "web", "--yes"], clone);
  expect(result.code, result.out).toBe(0);
  expect(await resolveDesignFolder("web", "test", { cwd: clone, onFail })).toBe(folder);
  expect(await resolveProjectRoot(folder)).toBe(clone);
});

test("missing mappings, malformed ids, missing content and ambiguous projects fail actionably", async () => {
  expect(
    RepoManifestSchema.safeParse({ projects: { web: { managed: "../../escape" } } }).success,
  ).toBe(false);
  expect(
    RepoManifestSchema.safeParse({ projects: { web: { managed: "C:\\external" } } }).success,
  ).toBe(false);
  const folder = await init();
  await writeFile(
    join(app, "velloo.json"),
    JSON.stringify({ projects: { web: { managed: "unknown_id" } } }),
  );
  await expect(resolveDesignFolder("web", "test", { cwd: app, onFail })).rejects.toThrow(
    "folder bind",
  );
  await writeFile(
    join(app, "velloo.json"),
    JSON.stringify({
      projects: { web: { managed: folder.split("/").pop() }, second: { managed: "unknown_id" } },
    }),
  );
  await expect(resolveDesignFolder(undefined, "test", { cwd: app, onFail })).rejects.toThrow(
    "several projects",
  );
  await rm(folder, { recursive: true });
  await expect(resolveDesignFolder("web", "test", { cwd: app, onFail })).rejects.toThrow(
    "no .design/config.json",
  );
});

test("manifest-supplied legacy escaping paths require an explicit path and are not rewritten", async () => {
  const folder = await init(false);
  const outside = join(root, "legacy");
  await rename(folder, outside);
  const text = JSON.stringify({ projects: { web: outside } });
  await writeFile(join(app, "velloo.json"), text);
  await expect(resolveDesignFolder("web", "test", { cwd: app, onFail })).rejects.toThrow(
    "Pass the design path explicitly",
  );
  expect(await resolveDesignFolder(outside, "test", { cwd: app, onFail })).toBe(outside);
  expect(await readFile(join(app, "velloo.json"), "utf8")).toBe(text);
});

test("managed symlinks cannot redirect a locator outside managed storage", async () => {
  const folder = await init();
  const outside = join(root, "outside");
  await rename(folder, outside);
  await symlink(outside, folder);
  expect(() => managedDesignPath(basename(folder))).toThrow("symbolic link");
});

test("relocation in both directions preserves design identity, assets, app paths and default choice", async () => {
  const source = await init(false);
  const configBefore = JSON.parse(await readFile(join(source, ".design/config.json"), "utf8"));
  await writeFile(join(source, "assets/original.bin"), new Uint8Array([0, 4, 255]));
  const found = await findManifest(app);
  if (!found) throw new Error("Missing test manifest");
  await writeFile(found.path, JSON.stringify({ ...found.manifest, defaultProject: "web" }));
  const preview = await command(["folder", "relocate", "web", "--external"]);
  expect(preview.code, preview.out).toBe(0);
  expect(preview.out).toContain("Preview only");
  expect(existsSync(source)).toBe(true);
  const plan = await planRelocation(source, app, undefined, true);
  await relocateDesign(plan);
  expect(existsSync(source)).toBe(false);
  expect(await resolveDesignFolder(undefined, "test", { cwd: app, onFail })).toBe(plan.destination);
  expect((await loadDesignFolder(plan.destination)).config.folderId).toBe(configBefore.folderId);
  expect(new Uint8Array(await readFile(join(plan.destination, "assets/original.bin")))).toEqual(
    new Uint8Array([0, 4, 255]),
  );
  const back = await planRelocation(plan.destination, app, "design-restored", false);
  await relocateDesign(back);
  const restored = await loadDesignFolder(back.destination);
  expect(restored.config.folderId).toBe(configBefore.folderId);
  expect(hostAppRootFrom(back.destination, restored.config.hostApp)).toBe(app);
  expect((await findManifest(app))?.manifest.defaultProject).toBe("web");
  expect(existsSync(join(back.destination, ".git"))).toBe(true);
});

test("occupied destinations, invalid designs, and a changed manifest preserve the source", async () => {
  const source = await init(false);
  await mkdir(join(app, "occupied"));
  await expect(planRelocation(source, app, "occupied", false)).rejects.toThrow("occupied");
  const plan = await planRelocation(source, app, undefined, true);
  await writeFile(plan.manifestPath, `${plan.before}\n`);
  await expect(relocateDesign(plan)).rejects.toThrow("manifest changed");
  expect(existsSync(source)).toBe(true);
  expect(existsSync(plan.destination)).toBe(false);
  const next = await planRelocation(source, app, undefined, true);
  await writeFile(join(source, "screens/broken.json"), "{");
  await expect(relocateDesign(next)).rejects.toThrow();
  expect(existsSync(source)).toBe(true);
  expect(existsSync(next.destination)).toBe(false);
});

test("checkpoints exclude runtime and revert restores only the standalone design", async () => {
  const folder = await init();
  await mkdir(join(folder, ".design/cache"), { recursive: true });
  await writeFile(join(folder, ".design/cache/runtime.json"), "runtime");
  await writeFile(join(app, "application.txt"), "uncommitted application work");
  await writeFile(join(folder, "assets/checkpoint.txt"), "saved");
  const sha = await checkpoint(folder, "Approved draft");
  expect(git(folder, "rev-parse", "HEAD")).toBe(sha);
  expect(git(folder, "ls-files")).not.toContain("runtime.json");
  await writeFile(join(folder, "assets/checkpoint.txt"), "modified");
  await writeFile(join(folder, "assets/untracked.txt"), "discard");
  const design = await loadDesignFolder(folder);
  const router = createRevertRouter(
    () => design,
    () => {},
  );
  const response = await router.request("/", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await readFile(join(folder, "assets/checkpoint.txt"), "utf8")).toBe("saved");
  expect(existsSync(join(folder, "assets/untracked.txt"))).toBe(false);
  expect(existsSync(join(folder, ".design/cache/runtime.json"))).toBe(true);
  expect(await readFile(join(app, "application.txt"), "utf8")).toBe("uncommitted application work");
  await writeFile(join(folder, "screens/broken.json"), "{");
  await expect(checkpoint(folder, "Invalid")).rejects.toThrow();
  expect(git(folder, "rev-parse", "HEAD")).toBe(sha);
  expect(existsSync(join(folder, "screens/broken.json"))).toBe(true);
});

test("removing an external registration retains its design and history", async () => {
  const folder = await init();
  const result = await command(["folder", "remove", "web", "--yes"]);
  expect(result.code, result.out).toBe(0);
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  expect(existsSync(join(folder, ".design/config.json"))).toBe(true);
  expect(existsSync(join(folder, ".git"))).toBe(true);
  expect(() => managedProjectContext(folder)).toThrow("manifest");
});

test("command matrix resolves external designs for folder, capture, emit, render, export, theme and upgrade", async () => {
  const folder = await init();
  const design = await loadDesignFolder(folder);
  const screen = [...design.screens.keys()][0];
  if (!screen) throw new Error("Missing sample screen");
  const commands = [
    ["folder", "list"],
    ["capture", "--folder=web", "--list"],
    ["emit", screen, "--folder=web"],
    ["render", screen, "--folder=web", "--to=render.html"],
    ["export", screen, "--folder=web", "--to=export.html", "--yes"],
    ["theme:export", "--folder=web", `--to=${app}`],
    ["upgrade", "web", "--no-skills"],
    ["folder", "checkpoint", "web", "--message=CLI checkpoint"],
  ];
  for (const args of commands) {
    const result = await command(args);
    expect(result.code, `${args.join(" ")}\n${result.out}`).toBe(0);
  }
  expect(existsSync(join(app, "render.html"))).toBe(true);
  expect(existsSync(join(app, "export.html"))).toBe(true);
});

test("nested application roots remain portable when a monorepo checkout moves", async () => {
  await init();
  const nested = join(app, "apps/admin");
  await mkdir(nested, { recursive: true });
  const added = await command([
    "init",
    nested,
    "--external",
    "--project=admin",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
  ]);
  expect(added.code, added.out).toBe(0);
  const folder = await resolveDesignFolder(undefined, "test", { cwd: nested, onFail });
  expect(await resolveProjectRoot(folder)).toBe(nested);
  expect((await findManifest(app))?.manifest.projects.admin).toMatchObject({
    appRoot: "apps/admin",
  });
  const clone = join(root, "new-checkout");
  await cp(app, clone, { recursive: true });
  const bound = await command(["folder", "bind", "admin", "--yes"], clone);
  expect(bound.code, bound.out).toBe(0);
  expect(await resolveProjectRoot(folder)).toBe(join(clone, "apps/admin"));
  expect(hostAppRootFrom(folder, (await loadDesignFolder(folder)).config.hostApp)).toBe(
    join(clone, "apps/admin"),
  );
});

test("external daemon restarts, agent stdio launch attaches, and out-of-band edits reload", async () => {
  const folder = await init();
  const lock = join(folder, ".design/cache/runtime.json");
  const start = async () => {
    const result = await command(["run", "web", "--background", "--port=0"]);
    expect(result.code, result.out).toBe(0);
    return JSON.parse(await readFile(lock, "utf8")) as { canvasUrl: string; pid: number };
  };
  try {
    const first = await start();
    const summary = (await fetch(`${first.canvasUrl}/api/design`).then((r) => r.json())) as {
      folderName: string;
    };
    expect(summary.folderName).toBe("web");
    const design = await loadDesignFolder(folder);
    const screen = [...design.screens.values()][0];
    if (!screen) throw new Error("Missing sample screen");
    await writeFile(
      join(folder, `screens/${screen.id}.json`),
      JSON.stringify({ ...screen, name: "Edited outside Velloo" }),
    );
    let refreshed = false;
    for (let i = 0; i < 30; i++) {
      const state = (await fetch(`${first.canvasUrl}/api/design`).then((r) => r.json())) as {
        screens: { name: string }[];
      };
      if (state.screens.some((s) => s.name === "Edited outside Velloo")) {
        refreshed = true;
        break;
      }
      await Bun.sleep(100);
    }
    expect(refreshed).toBe(true);
    const status = await command(["status"]);
    expect(status.out).toContain("web");
    expect((await command(["stop", "web"])).code).toBe(0);
    const second = await start();
    expect(second.pid).not.toBe(first.pid);
    const agent = Bun.spawn([process.execPath, cli, "mcp", "web"], {
      cwd: app,
      env: { ...process.env, VELLOO_DAEMONS_PATH: join(root, "daemons.json") },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      agent.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "managed-test", version: "1" } } })}\n`,
      );
      agent.stdin.flush();
      const reader = agent.stdout.getReader();
      let text = "";
      const initialized = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return false;
          text += new TextDecoder().decode(value);
          if (text.includes('"serverInfo"')) return true;
        }
      })();
      expect(await Promise.race([initialized, Bun.sleep(10000).then(() => false)])).toBe(true);
    } finally {
      agent.kill();
      await agent.exited;
    }
  } finally {
    await command(["stop", "web"]);
  }
}, 45000);

test("publish and changed-since use the external design checkpoint and manifest project title", async () => {
  const folder = await init();
  const { changedPreviewsSince } = await import("../publish/changed-previews.ts");
  const original = await loadDesignFolder(folder);
  const screen = [...original.screens.values()][0];
  if (!screen) throw new Error("Missing sample screen");
  await writeFile(
    join(folder, `screens/${screen.id}.json`),
    JSON.stringify({ ...screen, name: "Checkpoint version" }),
  );
  await checkpoint(folder, "Version two");
  const selection = changedPreviewsSince(
    folder,
    "HEAD~1",
    [...original.screens.values()],
    original.snippets,
    [...original.boards.values()],
  );
  expect([...selection.screenIds]).toContain(screen.id);
  let link: Record<string, unknown> = {};
  let commit: string | null = null;
  let repo: string | null = null;
  let files: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/v1/links") {
        link = (await request.json()) as Record<string, unknown>;
        return Response.json(
          { slug: "managed", visibility: "public", passwordProtected: false },
          { status: 201 },
        );
      }
      if (request.method === "POST" && path.endsWith("/versions")) {
        const data = await request.formData();
        commit = data.get("commitSha") as string | null;
        repo = data.get("gitRepo") as string | null;
        files = data
          .getAll("file")
          .flatMap((value) => (typeof value === "string" ? [] : [value.name]));
        return Response.json(
          { files: files.length, bytes: 1, url: "/s/managed/" },
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const published = await command([
      "publish",
      "web",
      "--url",
      `http://localhost:${server.port}`,
      "--token=test-token",
      "--new",
      "--slug=managed",
      "--public",
    ]);
    expect(published.code, published.out).toBe(0);
    expect(published.out).toContain("no git remote");
    expect(link.title).toBe("web designs");
    expect(link.folderId).toBe(original.config.folderId);
    expect(commit as string | null).toBe(git(folder, "rev-parse", "HEAD"));
    expect(repo).toBeNull();
    expect(files).toContain("design.json");
    expect(files.some((path) => path.includes(".locations") || path.startsWith(".git"))).toBe(
      false,
    );
  } finally {
    server.stop(true);
  }
});

test("application path aliases share one binding and still allow relocation", async () => {
  const alias = join(root, "application-alias");
  await symlink(app, alias);
  const result = await command([
    "init",
    alias,
    "--external",
    "--project=web",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
  ]);
  expect(result.code, result.out).toBe(0);
  const folder = await resolveDesignFolder("web", "test", { cwd: app, onFail });
  expect(realpathSync(await resolveProjectRoot(folder))).toBe(app);
  const plan = await planRelocation(realpathSync(folder), app, "restored", false);
  await relocateDesign(plan);
  expect(existsSync(join(app, "restored/.design/config.json"))).toBe(true);
});

test("relocation rejects destination aliases into the source or outside the repository", async () => {
  const source = await init(false);
  await symlink(source, join(app, "source-alias"));
  await expect(planRelocation(source, app, "source-alias/nested", false)).rejects.toThrow(
    "contain each other",
  );
  await symlink(root, join(app, "outside-alias"));
  await expect(planRelocation(source, app, "outside-alias/new", false)).rejects.toThrow(
    "inside the application repository",
  );
  expect(existsSync(source)).toBe(true);
});

test("missing Git retains newly scaffolded content and reports initialization failure", async () => {
  const result = await command(
    [
      "init",
      "--external",
      "--project=web",
      "--non-interactive",
      "--no-connect",
      "--library=none",
      "--start=blank",
    ],
    app,
    { PATH: join(root, "no-executables") },
  );
  expect(result.code).toBe(1);
  expect(result.out).toContain("Git operation failed");
  expect(result.out).toContain("content was retained");
  expect(result.out).not.toContain("installed and ready");
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  const storage = join(root, "user-data/designs");
  const entries = await readdir(storage);
  expect(entries).toHaveLength(1);
  const id = entries[0];
  if (!id) throw new Error("Expected retained design");
  expect(existsSync(join(storage, id, ".design/config.json"))).toBe(true);
  expect(existsSync(join(storage, id, "theme/default.json"))).toBe(true);
});
