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
import {
  hostAppRootFrom,
  loadDesignFolder,
  localDesignOf,
  managedDesignPath,
  readRepoFeedback,
  recordedDesignName,
  resolveAppPath,
  writeRepoFeedback,
} from "@velloo/server";
import { connect } from "../connect/index.ts";
import { resolveProjectRoot } from "../connect/project-root.ts";
import { resolveDesign } from "../design.ts";
import { planRelocation, relocateDesign } from "../managed-folders.ts";
import { designLabel, findManifest } from "../manifest.ts";
import { changedPreviewsSince } from "../publish/changed-previews.ts";
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
    "--name=web",
    ...(external ? ["--external"] : []),
  ]);
  expect(result.code, result.out).toBe(0);
  return resolveDesign("web", "test", { cwd: app, onFail });
}

function git(folder: string, ...args: string[]) {
  return execFileSync(
    "git",
    ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

test("external init records the design on this machine only, without Git", async () => {
  const folder = await init();
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  expect(localDesignOf(folder)).toMatchObject({ root: app, appRoot: app });
  expect(recordedDesignName(folder)).toBe("web");
  expect(folder.startsWith(app)).toBe(false);
  expect(await resolveDesign("web", "test", { cwd: join(app), onFail })).toBe(folder);
  expect(await resolveDesign(app, "test", { cwd: root, onFail })).toBe(folder);
  expect(await resolveProjectRoot(folder)).toBe(app);
  const design = await loadDesignFolder(folder);
  expect(hostAppRootFrom(folder, design.config.hostApp)).toBe(app);
  expect(design.config.hostApp?.root).toBe("app:.");
  expect(existsSync(join(folder, ".git"))).toBe(false);
  expect(await designLabel(folder)).toContain("web");
});

test("a managed design never borrows a repository from above its storage", async () => {
  const folder = await init();
  const design = await loadDesignFolder(folder);
  git(root, "init", "-q", "--initial-branch=dotfiles");
  git(root, "remote", "add", "origin", "https://github.com/acme/dotfiles");
  git(root, "commit", "-q", "--allow-empty", "-m", "dotfiles");
  expect(gitContext(folder)).toEqual({ repo: null, branch: null });
  expect(() =>
    changedPreviewsSince(folder, "HEAD", [...design.screens.values()], design.snippets, [
      ...design.boards.values(),
    ]),
  ).toThrow("not in a git repository");
});

test("a custom path outside the checkout becomes a local design that run resolves", async () => {
  const result = await command([
    "init",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
    "--name=coda",
    "--design-folder=../codaaaa",
  ]);
  expect(result.code, result.out).toBe(0);
  expect(result.out).toContain('local design "coda"');
  const folder = join(app, "..", "codaaaa");
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  expect(localDesignOf(folder)).toMatchObject({ root: app });
  expect(recordedDesignName(folder)).toBe("coda");
  expect(await resolveDesign(undefined, "run", { cwd: app, onFail })).toBe(folder);
  expect((await loadDesignFolder(folder)).config.hostApp?.root).toBe("app:.");
});

test("host references and feedback stay with the local design, never the checkout", async () => {
  const folder = await init();
  await mkdir(join(app, "apps/admin"), { recursive: true });
  expect(resolveAppPath(folder, "app:apps\\admin")).toBe(join(app, "apps/admin"));
  expect(hostAppRootFrom(folder, { root: "app:apps/admin" })).toBe(join(app, "apps/admin"));
  // The checkout's velloo.json is a committed file; a local design never writes it.
  await writeFile(join(app, "velloo.json"), JSON.stringify({ designs: [] }));
  expect(await writeRepoFeedback(folder, { enabled: true })).toBeNull();
  expect(await readRepoFeedback(folder)).toBeNull();
  expect(await readFile(join(app, "velloo.json"), "utf8")).not.toContain("feedback");
});

test("agents are wired globally for a local design, and nothing lands in the checkout", async () => {
  const folder = await init();
  const home = join(root, "home");
  const refused = await connect({
    designFolder: folder,
    agents: ["cursor"],
    installSkill: true,
    homeDir: home,
  });
  expect(refused.projectScoped).toEqual(["cursor"]);
  expect(refused.configs).toEqual([]);
  const wired = await connect({
    designFolder: folder,
    agents: ["cursor-global"],
    installSkill: true,
    homeDir: home,
  });
  expect(wired.projectScoped).toEqual([]);
  const config = JSON.parse(await readFile(join(home, ".cursor/mcp.json"), "utf8"));
  expect(config.mcpServers.velloo.args).toEqual(["mcp"]);
  expect(await readdir(app)).toEqual(["package.json"]);
  const explicit = await command(["connect", "web", "--agent=cursor"]);
  expect(explicit.code).toBe(1);
  expect(explicit.out).toContain("cursor-global");
});

test("a clone sees no local design until it is bound there", async () => {
  const folder = await init();
  const clone = join(root, "clone");
  await cp(app, clone, { recursive: true });
  await expect(
    resolveDesign("web", "test", { cwd: clone, onFail, requireConfig: true }),
  ).rejects.toThrow("not a velloo design folder");
  const result = await command(["design", "bind", folder, "--yes"], clone);
  expect(result.code, result.out).toBe(0);
  expect(await resolveDesign("web", "test", { cwd: clone, onFail })).toBe(folder);
  expect(await resolveProjectRoot(folder)).toBe(clone);
});

test("old managed locators, moved checkouts, missing content and ambiguity fail actionably", async () => {
  const folder = await init();
  await writeFile(
    join(app, "velloo.json"),
    JSON.stringify({ projects: { web: { managed: basename(folder) } } }),
  );
  await expect(resolveDesign("web", "test", { cwd: app, onFail })).rejects.toThrow("design bind");
  await rm(join(app, "velloo.json"));

  const moved = join(root, "moved");
  await rename(app, moved);
  await expect(resolveDesign(undefined, "test", { cwd: moved, onFail })).rejects.toThrow(
    "no longer exist at their old paths",
  );
  // An empty directory can't be that checkout, so it isn't told about it.
  const empty = join(root, "empty");
  await mkdir(empty);
  await expect(resolveDesign(undefined, "test", { cwd: empty, onFail })).rejects.toThrow(
    /^no velloo.json or design folder[^\n]*$/,
  );
  await rename(moved, app);

  // An in-repo design can't take a name the local design already has.
  const taken = await command([
    "init",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
    "--name=web",
  ]);
  expect(taken.code, taken.out).toBe(1);
  expect(taken.out).toContain('a design named "web" already exists');
  const named = await command([
    "init",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
    "--name=web-2",
  ]);
  expect(named.code, named.out).toBe(0);
  expect(await resolveDesign("web", "test", { cwd: app, onFail })).toBe(folder);
  expect(await resolveDesign("web-2", "test", { cwd: app, onFail })).toBe(join(app, "velloo"));

  // The name lives in the design's own config, so once the folder is gone the
  // name goes with it — only the path is left to report.
  await rm(folder, { recursive: true });
  await expect(resolveDesign("web", "test", { cwd: app, onFail })).rejects.toThrow(
    'unknown design "web"',
  );
});

test("a velloo.json path outside the repository needs an explicit path, or bind", async () => {
  const folder = await init(false);
  const outside = join(root, "legacy");
  await rename(folder, outside);
  const text = JSON.stringify({ designs: [outside] });
  await writeFile(join(app, "velloo.json"), text);
  await expect(resolveDesign("web", "test", { cwd: app, onFail })).rejects.toThrow(
    "Pass the design path explicitly",
  );
  expect(await resolveDesign(outside, "test", { cwd: app, onFail })).toBe(outside);
  expect(await readFile(join(app, "velloo.json"), "utf8")).toBe(text);
  const bound = await command(["design", "bind", outside, "--yes"]);
  expect(bound.code, bound.out).toBe(0);
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  expect(await resolveDesign("web", "test", { cwd: app, onFail })).toBe(outside);
});

test("managed symlinks cannot redirect a locator outside managed storage", async () => {
  const folder = await init();
  const outside = join(root, "outside");
  await rename(folder, outside);
  await symlink(outside, folder);
  expect(() => managedDesignPath(basename(folder))).toThrow("symbolic link");
});

test("relocation between the repository, managed storage and a chosen directory keeps the design", async () => {
  const source = await init(false);
  const configBefore = JSON.parse(await readFile(join(source, ".design/config.json"), "utf8"));
  await writeFile(join(source, "assets/original.bin"), new Uint8Array([0, 4, 255]));
  const preview = await command(["design", "move", "web", "--external"]);
  expect(preview.code, preview.out).toBe(0);
  expect(preview.out).toContain("Preview only");
  expect(preview.out).toContain("local design");
  expect(existsSync(source)).toBe(true);

  const plan = await planRelocation(source, app, undefined, true);
  await relocateDesign(plan);
  expect(existsSync(source)).toBe(false);
  // Its only design left, so the committed manifest goes with it.
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  expect(localDesignOf(plan.destination)).not.toBeNull();
  expect(recordedDesignName(plan.destination)).toBe("web");
  expect(await resolveDesign(undefined, "test", { cwd: app, onFail })).toBe(plan.destination);
  expect((await loadDesignFolder(plan.destination)).config.folderId).toBe(configBefore.folderId);
  expect(new Uint8Array(await readFile(join(plan.destination, "assets/original.bin")))).toEqual(
    new Uint8Array([0, 4, 255]),
  );

  const chosen = join(root, "elsewhere");
  const aside = await planRelocation(plan.destination, app, chosen, false);
  await relocateDesign(aside);
  expect(localDesignOf(chosen)).toMatchObject({ id: basename(plan.destination), root: app });
  expect(hostAppRootFrom(chosen, (await loadDesignFolder(chosen)).config.hostApp)).toBe(app);

  const back = await planRelocation(chosen, app, "design-restored", false);
  await relocateDesign(back);
  const restored = await loadDesignFolder(back.destination);
  expect(restored.config.folderId).toBe(configBefore.folderId);
  expect(hostAppRootFrom(back.destination, restored.config.hostApp)).toBe(app);
  expect(localDesignOf(back.destination)).toBeNull();
  expect((await findManifest(app))?.manifest.designs).toEqual(["design-restored"]);
  expect(existsSync(join(back.destination, ".git"))).toBe(false);
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

test("removing a local design forgets it and retains its content", async () => {
  const folder = await init();
  const result = await command(["design", "remove", "web", "--yes"]);
  expect(result.code, result.out).toBe(0);
  expect(existsSync(join(folder, ".design/config.json"))).toBe(true);
  expect(localDesignOf(folder)).toBeNull();
});

test("an in-repo and an out-of-repo design are peers: neither is picked for you, both upgrade, --id reaches either", async () => {
  const external = await init();
  const inRepo = await command([
    "init",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
    "--name=site",
  ]);
  expect(inRepo.code, inRepo.out).toBe(0);
  const site = join(app, "velloo");

  // At the checkout root the in-repo design used to win just for being inside it.
  await expect(resolveDesign(undefined, "design remove", { cwd: app, onFail })).rejects.toThrow(
    "several designs",
  );

  const listed = await command(["design", "list"]);
  expect(listed.out).toMatch(/1\s+\S*\s*site/);
  expect(listed.out).toMatch(/2\s+\S*\s*web/);

  // Put both back on the previous format; a bare upgrade migrates every one.
  for (const folder of [site, external]) {
    const path = join(folder, ".design/config.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...config, schemaVersion: 3 }));
  }
  const upgraded = await command(["upgrade", "--design-only", "--no-skills"]);
  expect(upgraded.code, upgraded.out).toBe(0);
  for (const folder of [site, external]) {
    const config = JSON.parse(await readFile(join(folder, ".design/config.json"), "utf8"));
    expect(config.schemaVersion).toBe(4);
  }

  const renamed = await command(["design", "rename", "--id", "1", "Site 🎨"]);
  expect(renamed.code, renamed.out).toBe(0);
  expect(recordedDesignName(site)).toBe("Site 🎨");

  const removed = await command(["design", "remove", "--id", "2", "--yes"]);
  expect(removed.code, removed.out).toBe(0);
  expect(localDesignOf(external)).toBeNull();
  expect(existsSync(site)).toBe(true);

  const missing = await command(["design", "remove", "--id", "5", "--yes"]);
  expect(missing.code).toBe(1);
  expect(missing.out).toContain("no design #5");
});

test("command matrix resolves external designs for design, capture, emit, render, export, theme and upgrade", async () => {
  const folder = await init();
  const design = await loadDesignFolder(folder);
  const screen = [...design.screens.keys()][0];
  if (!screen) throw new Error("Missing sample screen");
  const commands = [
    ["design", "list"],
    ["capture", "list", "--design=web"],
    ["emit", screen, "--design=web"],
    ["render", screen, "--design=web", "--to=render.html"],
    ["export", screen, "--design=web", "--to=export.html", "--yes"],
    ["theme", "export", "--design=web", `--to=${app}`],
    ["upgrade", "web", "--no-skills"],
  ];
  for (const args of commands) {
    const result = await command(args);
    expect(result.code, `${args.join(" ")}\n${result.out}`).toBe(0);
  }
  expect(existsSync(join(app, "render.html"))).toBe(true);
  expect(existsSync(join(app, "export.html"))).toBe(true);
});

test("nested application roots follow a monorepo checkout that moves", async () => {
  await mkdir(join(app, ".git"));
  await init();
  const nested = join(app, "apps/admin");
  await mkdir(nested, { recursive: true });
  const added = await command([
    "init",
    nested,
    "--external",
    "--name=admin",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
  ]);
  expect(added.code, added.out).toBe(0);
  const folder = await resolveDesign(undefined, "test", { cwd: nested, onFail });
  // Init ran for apps/admin, so that is the design's project — independent of
  // the repository root's own design.
  expect(await resolveProjectRoot(folder)).toBe(nested);
  expect(localDesignOf(folder)).toMatchObject({ root: nested, appRoot: nested });
  expect(resolveDesign(undefined, "test", { cwd: app, onFail })).resolves.not.toBe(folder);
  const clone = join(root, "new-checkout");
  await cp(app, clone, { recursive: true });
  const bound = await command(["design", "bind", folder, "--yes"], join(clone, "apps/admin"));
  expect(bound.code, bound.out).toBe(0);
  expect(await resolveProjectRoot(folder)).toBe(join(clone, "apps/admin"));
  expect(hostAppRootFrom(folder, (await loadDesignFolder(folder)).config.hostApp)).toBe(
    join(clone, "apps/admin"),
  );
});

test("renaming a design with its canvas running keeps the canvas up", async () => {
  const folder = await init();
  const lock = join(folder, ".design/cache/runtime.json");
  const started = await command(["run", "web", "--background", "--port=0"]);
  expect(started.code, started.out).toBe(0);
  const before = JSON.parse(await readFile(lock, "utf8")) as { canvasUrl: string; pid: number };
  try {
    const renamed = await command(["design", "rename", "web", "site"]);
    expect(renamed.code, renamed.out).toBe(0);
    const after = JSON.parse(await readFile(lock, "utf8")) as { pid: number };
    expect(after.pid).toBe(before.pid);
    const summary = (await fetch(`${before.canvasUrl}/api/design`).then((r) => r.json())) as {
      designName: string;
    };
    expect(summary.designName).toBe("site");
    expect(recordedDesignName(folder)).toBe("site");
  } finally {
    await command(["stop", "--all"]);
  }
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
      designName: string;
    };
    expect(summary.designName).toBe("web");
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

test("publish and changed-since use a repository the user keeps in the managed design", async () => {
  const folder = await init();
  git(folder, "init", "-q", "--initial-branch=main");
  git(folder, "add", "--all");
  git(folder, "commit", "-q", "-m", "Version one");
  const original = await loadDesignFolder(folder);
  const screen = [...original.screens.values()][0];
  if (!screen) throw new Error("Missing sample screen");
  await writeFile(
    join(folder, `screens/${screen.id}.json`),
    JSON.stringify({ ...screen, name: "Second version" }),
  );
  git(folder, "commit", "-q", "-am", "Version two");
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
    "--name=web",
    "--non-interactive",
    "--no-connect",
    "--library=none",
    "--start=blank",
  ]);
  expect(result.code, result.out).toBe(0);
  const folder = await resolveDesign("web", "test", { cwd: app, onFail });
  expect(realpathSync(await resolveProjectRoot(folder))).toBe(app);
  const plan = await planRelocation(realpathSync(folder), app, "restored", false);
  await relocateDesign(plan);
  expect(existsSync(join(app, "restored/.design/config.json"))).toBe(true);
});

test("relocation sees through destination aliases into the source or outside the repository", async () => {
  const source = await init(false);
  await symlink(source, join(app, "source-alias"));
  await expect(planRelocation(source, app, "source-alias/nested", false)).rejects.toThrow(
    "contain each other",
  );
  await symlink(root, join(app, "outside-alias"));
  // A path that only looks inside the repository is outside it, so it is local.
  const plan = await planRelocation(source, app, "outside-alias/new", false);
  expect(plan.destinationLocal).toBeDefined();
  expect(plan.manifest).toBeNull();
  expect(existsSync(source)).toBe(true);
});

test("external init succeeds without Git installed", async () => {
  const result = await command(
    [
      "init",
      "--external",
      "--name=web",
      "--non-interactive",
      "--no-connect",
      "--library=none",
      "--start=blank",
    ],
    app,
    { PATH: join(root, "no-executables") },
  );
  expect(result.code, result.out).toBe(0);
  expect(existsSync(join(app, "velloo.json"))).toBe(false);
  const storage = join(root, "user-data/designs");
  const entries = (await readdir(storage)).filter((name) => !name.startsWith("."));
  expect(entries).toHaveLength(1);
  const id = entries[0];
  if (!id) throw new Error("Expected a managed design");
  expect(existsSync(join(storage, id, ".design/config.json"))).toBe(true);
  expect(existsSync(join(storage, id, ".git"))).toBe(false);
});

test("a plain directory inside a home-directory repository gets its own manifest", async () => {
  git(root, "init", "-q");
  const plain = join(root, "mydesign");
  await mkdir(plain);
  const result = await command(
    ["init", "--non-interactive", "--no-connect", "--library=none", "--start=blank"],
    plain,
    { HOME: root },
  );
  expect(result.code, result.out).toBe(0);
  expect(existsSync(join(plain, "velloo.json"))).toBe(true);
  expect(existsSync(join(root, "velloo.json"))).toBe(false);
});
