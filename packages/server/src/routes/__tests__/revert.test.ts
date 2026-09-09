import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { designScreen, scaffoldDesignFolder } from "../../testing/design-folder.ts";
import type { WatchEvent } from "../../watcher.ts";
import { createRevertRouter } from "../revert.ts";

/**
 * Revert-all is the safety valve for an agent session gone wrong, and the only
 * route in the server that destroys work on purpose. It was at 16%. What has
 * to hold is not that it deletes things — it's the boundaries: scoped to the
 * design folder even inside a larger repo, and `git clean` without `-x` so a
 * revert never takes the gitignored runtime state with it.
 *
 * These drive real git repositories in tmp. `GIT_CONFIG_GLOBAL=/dev/null` and
 * an empty `core.hooksPath` keep the machine's own git config and hooks out of
 * it, so the suite behaves the same on a laptop and on CI.
 */

let repoRoot: string;
let folder: DesignFolder;
let scaffolded: Awaited<ReturnType<typeof scaffoldDesignFolder>> | null = null;
let events: WatchEvent[];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(
    [
      "git",
      "-C",
      cwd,
      "-c",
      "core.hooksPath=",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.email=test@velloo.dev",
      "-c",
      "user.name=Velloo Test",
      ...args,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err.trim()}`);
  return out;
}

/** A design folder on disk, optionally nested one level inside its repo. */
async function makeFolder(opts: { nested?: boolean } = {}): Promise<void> {
  scaffolded = await scaffoldDesignFolder({
    label: "revert",
    screens: { home: true, pricing: true },
    files: { ".gitignore": ".design/cache/\n" },
  });
  if (opts.nested) {
    repoRoot = await mkdtemp(join(tmpdir(), "velloo-revert-repo-"));
    await rename(scaffolded.root, join(repoRoot, "design"));
    folder = await loadDesignFolder(join(repoRoot, "design"));
  } else {
    repoRoot = scaffolded.root;
    folder = await loadDesignFolder(scaffolded.root);
  }
}

/** Initialize a repo at the root and commit whatever is there. */
async function commitAll(): Promise<void> {
  await git(repoRoot, "init", "-q", "-b", "main");
  await git(repoRoot, "add", "-A");
  await git(repoRoot, "commit", "-q", "-m", "initial");
}

const app = () => {
  const hono = new Hono();
  hono.route(
    "/api/revert",
    createRevertRouter(
      () => folder,
      (e) => events.push(e),
    ),
  );
  return hono;
};

const status = async () => (await app().request("/api/revert/status")).json();
const revert = async () => app().request("/api/revert", { method: "POST" });

const screenPath = (id: string) => join(folder.root, "screens", `${id}.json`);

beforeEach(() => {
  events = [];
});

afterEach(async () => {
  await scaffolded?.cleanup();
  scaffolded = null;
  if (repoRoot) await rm(repoRoot, { recursive: true, force: true });
});

describe("status — when there is nothing to offer", () => {
  test("a folder outside any repository says so", async () => {
    await makeFolder();
    const body = (await status()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain("not inside a git repository");
  });

  test("a repository with no commits has nothing to restore from", async () => {
    await makeFolder();
    await git(repoRoot, "init", "-q", "-b", "main");
    const body = (await status()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain("no commits");
  });

  test("a clean folder has nothing to revert", async () => {
    await makeFolder();
    await commitAll();
    const body = (await status()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain("No uncommitted design changes");
  });
});

describe("status — what changed", () => {
  beforeEach(async () => {
    await makeFolder();
    await commitAll();
  });

  test("classifies modified, untracked and deleted files", async () => {
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await writeFile(join(folder.root, "screens/new.json"), "{}");
    await rm(screenPath("pricing"));
    const body = (await status()) as {
      available: boolean;
      files: { path: string; status: string }[];
    };
    expect(body.available).toBe(true);
    const byPath = Object.fromEntries(body.files.map((f) => [f.path, f.status]));
    expect(byPath["screens/home.json"]).toBe("modified");
    expect(byPath["screens/new.json"]).toBe("untracked");
    expect(byPath["screens/pricing.json"]).toBe("deleted");
  });

  test("a staged new file reads as added", async () => {
    await writeFile(join(folder.root, "screens/added.json"), "{}");
    await git(folder.root, "add", "screens/added.json");
    const body = (await status()) as { files: { path: string; status: string }[] };
    expect(body.files).toContainEqual({ path: "screens/added.json", status: "added" });
  });
});

describe("status — scoped to the design folder", () => {
  beforeEach(async () => {
    await makeFolder({ nested: true });
    await writeFile(join(repoRoot, "README.md"), "the app\n");
    await commitAll();
  });

  test("paths are relative to the folder, not the repository root", async () => {
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    const body = (await status()) as { files: { path: string }[] };
    // Not "design/screens/home.json" — the canvas shows folder-relative paths.
    expect(body.files.map((f) => f.path)).toEqual(["screens/home.json"]);
  });

  test("changes elsewhere in the repository are not this folder's business", async () => {
    await writeFile(join(repoRoot, "README.md"), "edited outside\n");
    await writeFile(join(repoRoot, "stray.txt"), "untracked outside\n");
    const body = (await status()) as { available: boolean; reason?: string };
    expect(body.available).toBe(false);
    expect(body.reason).toContain("No uncommitted design changes");
  });
});

describe("revert", () => {
  beforeEach(async () => {
    await makeFolder();
    await commitAll();
  });

  test("refuses with 409 when there is nothing to discard", async () => {
    const res = await revert();
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unavailable");
    expect(body.error.message).toContain("No uncommitted design changes");
  });

  test("restores what changed, removes what was added, brings back what was deleted", async () => {
    const original = await Bun.file(screenPath("home")).text();
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await writeFile(join(folder.root, "screens/new.json"), "{}");
    await rm(screenPath("pricing"));

    const res = await revert();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reverted: number; files: { path: string }[] };
    expect(body.reverted).toBe(3);
    expect(body.files.map((f) => f.path).sort()).toEqual([
      "screens/home.json",
      "screens/new.json",
      "screens/pricing.json",
    ]);

    expect(await Bun.file(screenPath("home")).text()).toBe(original);
    expect(await Bun.file(join(folder.root, "screens/new.json")).exists()).toBe(false);
    expect(await Bun.file(screenPath("pricing")).exists()).toBe(true);
  });

  test("leaves gitignored runtime state alone — clean runs without -x", async () => {
    const cache = join(folder.root, ".design/cache/build.json");
    await mkdir(join(folder.root, ".design/cache"), { recursive: true });
    await writeFile(cache, "{}");
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await revert();
    expect(await Bun.file(cache).exists()).toBe(true);
  });

  test("reloads the folder, so the canvas reads restored state", async () => {
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    const fresh = await loadDesignFolder(folder.root);
    folder.screens = fresh.screens;
    expect(folder.screens.get("home")?.name).toBe("Edited");
    await revert();
    expect(folder.screens.get("home")?.name).toBe("Home");
  });

  test("drops the undo history, which now describes state that is gone", async () => {
    folder.history.push({ kind: "screen", screenId: "home", screen: null });
    expect(folder.history.depths().undo).toBe(1);
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await revert();
    expect(folder.history.depths()).toEqual({ undo: 0, redo: 0 });
  });

  test("tells every client to drop its caches and boot again", async () => {
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await revert();
    expect(events).toEqual([{ type: "folder-reloaded" }]);
  });

  test("a refused revert broadcasts nothing and changes nothing", async () => {
    const before = await Bun.file(screenPath("home")).text();
    await revert();
    expect(events).toEqual([]);
    expect(await Bun.file(screenPath("home")).text()).toBe(before);
  });
});

describe("revert — inside a larger repository", () => {
  beforeEach(async () => {
    await makeFolder({ nested: true });
    await writeFile(join(repoRoot, "README.md"), "the app\n");
    await commitAll();
  });

  test("never reaches outside the design folder", async () => {
    await writeFile(screenPath("home"), JSON.stringify(designScreen("home", { name: "Edited" })));
    await writeFile(join(repoRoot, "README.md"), "edited outside\n");
    await writeFile(join(repoRoot, "stray.txt"), "untracked outside\n");

    const res = await revert();
    expect(res.status).toBe(200);

    // The design folder is restored...
    expect(await Bun.file(screenPath("home")).text()).not.toContain("Edited");
    // ...and the app around it is untouched, tracked and untracked alike.
    expect(await Bun.file(join(repoRoot, "README.md")).text()).toBe("edited outside\n");
    expect(await Bun.file(join(repoRoot, "stray.txt")).exists()).toBe(true);
  });
});
