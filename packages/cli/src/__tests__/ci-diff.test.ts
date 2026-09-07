import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Screen, ScreenSchema, type Snippet, SnippetSchema } from "@velloo/schema";
import {
  classifyChanges,
  detectChangedScreens,
  diffDesignFolder,
  materializeRef,
  type RawChange,
  resolveGitContext,
  snippetsUsedByScreen,
} from "../ci/diff.ts";

/**
 * Changed-screen detection for `publish --changed-since`: a temp git repo
 * fixture exercises the git plumbing end to end, and the pure classify/expand
 * functions cover the dependency rules — screen change → that screen,
 * theme/config change → all screens, snippet change → screens using it
 * (transitively), asset change → screens referencing it.
 */

/**
 * The developer's own git setup must not reach these repos. A global
 * `core.hooksPath` runs that machine's pre-commit hook on every fixture
 * commit, LFS filters spawn a helper per `git add`, and a credential helper
 * can block on a prompt that never comes — none of which this test is about,
 * and any of which can wedge a subprocess past the timeout. Set on the
 * process, not just the helper below, because `resolveGitContext` and
 * `materializeRef` spawn their own git.
 */
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_TERMINAL_PROMPT = "0";

// The git plumbing tests spawn real subprocesses. Under `bun test --parallel`
// those queue behind every other worker's, and the 5s default starts tripping.
setDefaultTimeout(30_000);

/** One parent dir for the whole file, removed in `afterAll` rather than per test. */
let root: string;
/** The committed base repo every test starts from — built once, copied per test. */
let fixture: string;
let caseNo = 0;

function gitIn(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "user.email=ci@test", "-c", "user.name=ci", ...args],
    // Pipe both ways rather than inheriting: an expected failure's `fatal:`
    // line is the test's business, not the reporter's, and a closed stdin
    // can't leave git blocked on a prompt nobody will answer.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const screenJson = (id: string, className: string, children: unknown[] = []): string =>
  JSON.stringify({
    id,
    name: id,
    library: "default",
    tree: { $ref: "Box", props: { className }, children },
  });

async function scaffold(at: string): Promise<void> {
  const dir = join(at, "velloo");
  await mkdir(join(dir, ".design"), { recursive: true });
  await mkdir(join(dir, "theme"), { recursive: true });
  await mkdir(join(dir, "screens"), { recursive: true });
  await mkdir(join(dir, "snippets"), { recursive: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, ".design", "config.json"), JSON.stringify({ schemaVersion: 3 }));
  await writeFile(join(dir, "theme", "default.json"), JSON.stringify({ name: "default" }));
  await writeFile(join(dir, "screens", "home.json"), screenJson("home", "bg-background"));
  await writeFile(join(dir, "screens", "about.json"), screenJson("about", "p-4"));
  await writeFile(
    join(dir, "snippets", "card.json"),
    JSON.stringify({ id: "card", name: "Card", params: [], tree: { $ref: "Box" } }),
  );
  await writeFile(join(dir, "assets", "logo.png"), "png-bytes");
  gitIn(at, ["init", "-q"]);
  gitIn(at, ["add", "-A"]);
  gitIn(at, ["commit", "-qm", "base"]);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "velloo-ci-diff-"));
  fixture = join(root, "fixture");
  await mkdir(fixture, { recursive: true });
  await scaffold(fixture);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Case {
  repo: string;
  design: string;
  git: (args: string[]) => string;
}

/**
 * A copy of the committed fixture, not a fresh `init`/`add`/`commit`: three
 * fewer subprocesses, and the base commit stays identical across tests.
 *
 * Called from the test body rather than a `beforeEach`, so the paths are local
 * consts. A shared binding is read by whichever code runs *last*: a test that
 * trips the 30s timeout keeps executing, and its next `git` call would reach
 * for a path the following test had already rebound — one slow test reported
 * as several broken ones.
 */
async function newCase(): Promise<Case> {
  caseNo += 1;
  const repo = join(root, `case-${caseNo}`);
  await cp(fixture, repo, { recursive: true });
  return { repo, design: join(repo, "velloo"), git: (args) => gitIn(repo, args) };
}

describe("git plumbing", () => {
  test("diffs base → worktree with add/modify/delete, scoped to the design folder", async () => {
    const { repo, design, git } = await newCase();
    const base = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-card"));
    await writeFile(join(design, "screens", "pricing.json"), screenJson("pricing", "p-8"));
    await rm(join(design, "screens", "about.json"));
    await writeFile(join(repo, "outside.txt"), "not a design file");
    git(["add", "-A"]);
    git(["commit", "-qm", "changes"]);

    const ctx = resolveGitContext(design, base, "HEAD");
    expect(ctx.designRel).toBe("velloo");
    expect(ctx.headIsWorktree).toBe(true);

    const changes = diffDesignFolder(ctx);
    const byPath = new Map(changes.map((c) => [c.path, c.status]));
    expect(byPath.get("screens/home.json")).toBe("M");
    expect(byPath.get("screens/pricing.json")).toBe("A");
    expect(byPath.get("screens/about.json")).toBe("D");
    expect([...byPath.keys()].some((p) => p.includes("outside.txt"))).toBe(false);
  });

  test("uncommitted worktree changes count when head is the checkout", async () => {
    const { design, git } = await newCase();
    const base = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-muted"));

    const changes = diffDesignFolder(resolveGitContext(design, base, "HEAD"));
    expect(changes).toEqual([{ status: "M", path: "screens/home.json" }]);
  });

  test("a head ref that isn't the checkout diffs ref-to-ref, ignoring the worktree", async () => {
    const { design, git } = await newCase();
    const base = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-card"));
    git(["add", "-A"]);
    git(["commit", "-qm", "middle"]);
    const middle = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "about.json"), screenJson("about", "bg-accent"));
    git(["add", "-A"]);
    git(["commit", "-qm", "tip"]);
    // A dirty edit past the head ref must not leak into a ref-to-ref diff.
    await writeFile(join(design, "screens", "about.json"), screenJson("about", "bg-muted"));

    const ctx = resolveGitContext(design, base, middle);
    expect(ctx.headIsWorktree).toBe(false);
    expect(diffDesignFolder(ctx)).toEqual([{ status: "M", path: "screens/home.json" }]);
  });

  test("materializeRef snapshots the base design folder without touching the tree", async () => {
    const { design, git } = await newCase();
    const base = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-card"));
    git(["add", "-A"]);
    git(["commit", "-qm", "changes"]);

    const ctx = resolveGitContext(design, base, "HEAD");
    const mat = await materializeRef(ctx, ctx.baseSha);
    expect(mat).not.toBeNull();
    if (!mat) return;
    const snapshot = await Bun.file(join(mat.designDir, "screens", "home.json")).text();
    expect(snapshot).toContain("bg-background"); // the base version, not the edit
    const worktree = await Bun.file(join(design, "screens", "home.json")).text();
    expect(worktree).toContain("bg-card"); // untouched
    await rm(mat.root, { recursive: true, force: true });
  });

  test("materializeRef returns null when the ref has no design folder", async () => {
    const { design, git } = await newCase();
    git(["rm", "-rq", "velloo"]);
    git(["commit", "-qm", "drop design"]);
    const emptyBase = git(["rev-parse", "HEAD"]).trim();
    await mkdir(join(design, ".design"), { recursive: true });
    await writeFile(join(design, ".design", "config.json"), "{}");

    const ctx = resolveGitContext(design, emptyBase, "HEAD");
    expect(await materializeRef(ctx, ctx.baseSha)).toBeNull();
  });
});

describe("classifyChanges", () => {
  test("routes paths to screens / global / snippets / assets and ignores the rest", () => {
    const changes: RawChange[] = [
      { status: "M", path: "screens/home.json" },
      { status: "A", path: "screens/pricing.json" },
      { status: "M", path: "screens/home.annotations.json" },
      { status: "M", path: "theme/default.json" },
      { status: "M", path: "snippets/card.json" },
      { status: "M", path: "assets/logo.png" },
      { status: "M", path: "boards/main.json" },
      { status: "M", path: ".design/links.json" },
    ];
    const set = classifyChanges(changes);
    expect([...set.screens.entries()]).toEqual([
      ["home", "M"],
      ["pricing", "A"],
    ]);
    expect(set.global).toBe(true);
    expect([...set.snippets]).toEqual(["card"]);
    expect([...set.assets]).toEqual(["/assets/logo.png"]);
  });

  test(".design/config.json is global; other .design files are not", () => {
    expect(classifyChanges([{ status: "M", path: ".design/config.json" }]).global).toBe(true);
    expect(classifyChanges([{ status: "M", path: ".design/links.json" }]).global).toBe(false);
  });
});

describe("detectChangedScreens — dependency rules", () => {
  const screen = (id: string, tree: unknown): Screen => ScreenSchema.parse({ id, name: id, tree });
  const snippet = (id: string, tree: unknown): Snippet =>
    SnippetSchema.parse({ id, name: id, params: [], tree });

  const screens = new Map<string, Screen>([
    ["uses-card", screen("uses-card", { $ref: "Box", children: [{ $snippet: "card" }] })],
    ["uses-hero", screen("uses-hero", { $ref: "Box", children: [{ $snippet: "hero" }] })],
    [
      "uses-logo",
      screen("uses-logo", {
        $ref: "Image",
        props: { src: "/assets/logo.png" },
      }),
    ],
    ["plain", screen("plain", { $ref: "Box", children: [] })],
  ]);
  // hero's body instantiates card — a card change reaches hero users transitively.
  const snippets = new Map<string, Snippet>([
    ["card", snippet("card", { $ref: "Box", props: { className: "bg-card" } })],
    ["hero", snippet("hero", { $ref: "Box", children: [{ $snippet: "card" }] })],
  ]);

  test("theme change marks every screen modified", () => {
    const out = detectChangedScreens(
      { screens: new Map(), global: true, snippets: new Set(), assets: new Set() },
      screens,
      snippets,
    );
    expect(out.map((s) => s.id).sort()).toEqual(["plain", "uses-card", "uses-hero", "uses-logo"]);
    expect(out.every((s) => s.status === "modified" && s.reasons.includes("theme"))).toBe(true);
  });

  test("snippet change marks its users — including transitive snippet-in-snippet users", () => {
    const out = detectChangedScreens(
      { screens: new Map(), global: false, snippets: new Set(["card"]), assets: new Set() },
      screens,
      snippets,
    );
    expect(out.map((s) => s.id).sort()).toEqual(["uses-card", "uses-hero"]);
    expect(out[0]?.reasons).toEqual(["snippet:card"]);
  });

  test("asset change marks only screens referencing it", () => {
    const out = detectChangedScreens(
      {
        screens: new Map(),
        global: false,
        snippets: new Set(),
        assets: new Set(["/assets/logo.png"]),
      },
      screens,
      snippets,
    );
    expect(out.map((s) => s.id)).toEqual(["uses-logo"]);
    expect(out[0]?.reasons).toEqual(["asset:/assets/logo.png"]);
  });

  test("direct add/delete wins over a dependency reason", () => {
    const out = detectChangedScreens(
      {
        screens: new Map([
          ["uses-card", "A"],
          ["gone", "D"],
        ]),
        global: true,
        snippets: new Set(),
        assets: new Set(),
      },
      screens,
      snippets,
    );
    const byId = new Map(out.map((s) => [s.id, s]));
    expect(byId.get("uses-card")?.status).toBe("added");
    expect(byId.get("gone")?.status).toBe("deleted");
    expect(byId.get("plain")?.status).toBe("modified");
  });

  test("snippetsUsedByScreen resolves transitively and tolerates cycles", () => {
    const cyclic = new Map<string, Snippet>([
      ["a", snippet("a", { $ref: "Box", children: [{ $snippet: "b" }] })],
      ["b", snippet("b", { $ref: "Box", children: [{ $snippet: "a" }] })],
    ]);
    const s = screen("s", { $ref: "Box", children: [{ $snippet: "a" }] });
    expect([...snippetsUsedByScreen(s, cyclic)].sort()).toEqual(["a", "b"]);
  });
});
