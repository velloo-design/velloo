import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
 * Changed-screen detection for `velloo ci`: a temp git repo
 * fixture exercises the git plumbing end to end, and the pure classify/expand
 * functions cover the dependency rules — screen change → that screen,
 * theme/config change → all screens, snippet change → screens using it
 * (transitively), asset change → screens referencing it.
 */

let tmp: string;
let repo: string;
let design: string;

function git(args: string[]): string {
  return execFileSync(
    "git",
    ["-C", repo, "-c", "user.email=ci@test", "-c", "user.name=ci", ...args],
    { encoding: "utf8" },
  );
}

const screenJson = (id: string, className: string, children: unknown[] = []): string =>
  JSON.stringify({
    id,
    name: id,
    library: "default",
    tree: { $ref: "Box", props: { className }, children },
  });

async function scaffold(): Promise<void> {
  await mkdir(join(design, ".design"), { recursive: true });
  await mkdir(join(design, "theme"), { recursive: true });
  await mkdir(join(design, "screens"), { recursive: true });
  await mkdir(join(design, "snippets"), { recursive: true });
  await mkdir(join(design, "assets"), { recursive: true });
  await writeFile(join(design, ".design", "config.json"), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(join(design, "theme", "default.json"), JSON.stringify({ name: "default" }));
  await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-background"));
  await writeFile(join(design, "screens", "about.json"), screenJson("about", "p-4"));
  await writeFile(
    join(design, "snippets", "card.json"),
    JSON.stringify({ id: "card", name: "Card", params: [], tree: { $ref: "Box" } }),
  );
  await writeFile(join(design, "assets", "logo.png"), "png-bytes");
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-ci-diff-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  repo = tmp;
  design = join(repo, "velloo");
  await scaffold();
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("git plumbing", () => {
  test("diffs base → worktree with add/modify/delete, scoped to the design folder", async () => {
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
    const base = git(["rev-parse", "HEAD"]).trim();
    await writeFile(join(design, "screens", "home.json"), screenJson("home", "bg-muted"));

    const changes = diffDesignFolder(resolveGitContext(design, base, "HEAD"));
    expect(changes).toEqual([{ status: "M", path: "screens/home.json" }]);
  });

  test("a head ref that isn't the checkout diffs ref-to-ref, ignoring the worktree", async () => {
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
