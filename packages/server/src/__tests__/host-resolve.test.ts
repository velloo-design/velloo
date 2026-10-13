import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { resolveHostPackage, resolveInHost } from "../host-resolve.ts";

/** A host app directory, holding the files given by relative path. */
function host(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "velloo-host-resolve-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function nodeModulesAbove(dir: string): boolean {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (dirname(at) === at) return false;
  }
}

/** The shape of a package directory in Bun's install cache. */
const CACHED = "store/widgets@1.2.3@@@1";
const aliasTo = (target: string): string =>
  JSON.stringify({ compilerOptions: { paths: { widgets: [`./${target}`] } } });

describe("resolveInHost", () => {
  test("an answer out of Bun's install cache is not the app's", () => {
    // Auto-install cannot be made to answer in-process — `bun test` never does
    // it — so an alias stands in for it, landing where the cache would.
    const root = host({
      "tsconfig.json": aliasTo(`${CACHED}/index.js`),
      [`${CACHED}/index.js`]: "",
    });
    expect(Bun.resolveSync("widgets", root)).toContain("@@@1");
    expect(() => resolveInHost("widgets", root)).toThrow("Cannot find module 'widgets'");
  });

  test("an alias still resolves with no node_modules anywhere", () => {
    const root = host({
      "tsconfig.json": aliasTo("src/widgets.ts"),
      "src/widgets.ts": "",
      "src/app.css": "",
    });
    expect(resolveInHost("widgets", root)).toEndWith(join("src", "widgets.ts"));
    expect(resolveInHost("./src/app.css", root)).toEndWith(join("src", "app.css"));
  });

  test("a package the app links into the cache is still the app's", () => {
    // `bun install --backend=symlink`: node_modules/<pkg> is a link into the
    // cache, so the resolved path has the cache's shape and is installed.
    const root = host({
      "package.json": JSON.stringify({ name: "app" }),
      [`${CACHED}/package.json`]: JSON.stringify({ name: "widgets", main: "index.js" }),
      [`${CACHED}/index.js`]: "",
    });
    mkdirSync(join(root, "node_modules"));
    symlinkSync(join(root, CACHED), join(root, "node_modules", "widgets"), "dir");
    expect(resolveInHost("widgets", root)).toContain("@@@1");
  });
});

describe("resolveHostPackage", () => {
  test("finds what the app installed, and nothing else", () => {
    const root = host({
      "node_modules/widgets/package.json": JSON.stringify({ name: "widgets", main: "index.js" }),
      "node_modules/widgets/index.js": "",
    });
    expect(resolveHostPackage("widgets/package.json", root)).toEndWith(
      join("node_modules", "widgets", "package.json"),
    );
    expect(resolveHostPackage("gadgets/package.json", root)).toBeNull();
  });
});

/**
 * A design that points at a monorepo's root while the app — and everything it
 * installs — is a workspace below it. Under an install that does not hoist,
 * the root has none of the app's packages.
 */
describe("a workspace root", () => {
  const widgets = (dir: string, version = "1.0.0"): Record<string, string> => ({
    [`${dir}/package.json`]: JSON.stringify({ name: dir.split("/").at(-1) }),
    [`${dir}/node_modules/widgets/package.json`]: JSON.stringify({
      name: "widgets",
      version,
      main: "index.js",
    }),
    [`${dir}/node_modules/widgets/index.js`]: "",
  });

  test("answers with the member that has the package", () => {
    const root = host({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["web"] }),
      "node_modules/.keep": "",
      ...widgets("web"),
    });
    const expected = join("web", "node_modules", "widgets", "index.js");
    expect(resolveHostPackage("widgets", root)).toEndWith(expected);
    expect(resolveInHost("widgets", root)).toEndWith(expected);
    expect(resolveHostPackage("gadgets", root)).toBeNull();
    expect(() => resolveInHost("gadgets", root)).toThrow();
  });

  test("reads the members a pattern names, and pnpm's own file", () => {
    const yarn = host({
      "package.json": JSON.stringify({ name: "repo", workspaces: { packages: ["apps/*"] } }),
      ...widgets("apps/web"),
    });
    expect(resolveHostPackage("widgets", yarn)).toEndWith(
      join("apps", "web", "node_modules", "widgets", "index.js"),
    );

    const pnpm = host({
      "package.json": JSON.stringify({ name: "repo" }),
      "pnpm-workspace.yaml":
        "packages:\n  - 'apps/**'\n  - \"!apps/legacy/**\"\ncatalog:\n  - nope\n",
      ...widgets("apps/site/web"),
      ...widgets("apps/legacy/old", "0.1.0"),
    });
    expect(resolveHostPackage("widgets", pnpm)).toEndWith(
      join("apps", "site", "web", "node_modules", "widgets", "index.js"),
    );
  });

  test("prefers its own copy to a member's", () => {
    const root = host({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["web"] }),
      "node_modules/widgets/package.json": JSON.stringify({ name: "widgets", main: "index.js" }),
      "node_modules/widgets/index.js": "",
      ...widgets("web", "2.0.0"),
    });
    expect(resolveInHost("widgets", root)).toEndWith(
      join(root.split(sep).at(-1) as string, "node_modules", "widgets", "index.js"),
    );
  });

  test("has no answer when two members install a copy each, and says which", () => {
    const root = host({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["apps/*"] }),
      ...widgets("apps/admin"),
      ...widgets("apps/web", "2.0.0"),
    });
    expect(resolveHostPackage("widgets", root)).toBeNull();
    expect(() => resolveInHost("widgets", root)).toThrow(
      "Its workspaces apps/admin, apps/web each have their own copy.",
    );
  });

  test("answers when the members share one copy", () => {
    // An isolated install links each member's dependency to the same store entry.
    const root = host({
      "package.json": JSON.stringify({ name: "repo", workspaces: ["apps/*"] }),
      "apps/admin/package.json": JSON.stringify({ name: "admin" }),
      ...widgets("apps/web"),
    });
    mkdirSync(join(root, "apps", "admin", "node_modules"));
    symlinkSync(
      join(root, "apps", "web", "node_modules", "widgets"),
      join(root, "apps", "admin", "node_modules", "widgets"),
      "dir",
    );
    expect(resolveHostPackage("widgets", root)).toEndWith(join("widgets", "index.js"));
  });

  test("is the only directory that answers for what is below it", () => {
    // No workspaces declared: `web` is somebody else's project, not this app's.
    const root = host({
      "package.json": JSON.stringify({ name: "app" }),
      "node_modules/.keep": "",
      ...widgets("web"),
    });
    expect(resolveHostPackage("widgets", root)).toBeNull();
    expect(() => resolveInHost("widgets", root)).toThrow();
  });
});

test("nothing else in the server asks Bun's resolver about a host app", () => {
  // A new probe written as `Bun.resolveSync(pkg, hostRoot)` is this bug again,
  // and no test of its own would show it: `bun test` never auto-installs.
  const source = resolve(import.meta.dir, "..");
  const callers = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(source)]
    .filter((file) => !file.includes("__tests__"))
    .filter((file) => readFileSync(join(source, file), "utf8").includes("Bun.resolveSync("))
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
  expect(callers).toEqual([
    "host-resolve.ts",
    // Velloo's own Tailwind, resolved from Velloo's install — not a host probe.
    "styles/host-stylesheet.ts",
  ]);
});

/**
 * The real thing: a plain `bun`, started the way nothing in the product starts
 * it — no `--no-install`, and away from this repo's bunfig.toml, which turns
 * auto-install off for everything run inside it. From an app with no
 * `node_modules` above it that Bun answers "is Mantine installed?" by
 * downloading Mantine, so the probes must not ask.
 */
describe("a host app with no node_modules", () => {
  const root = host({ "index.html": "<h1>static</h1>", "package.json": '{"name":"app"}' });

  async function probe(expression: string): Promise<{ answer: unknown; cached: string[] }> {
    const cache = mkdtempSync(join(tmpdir(), "velloo-bun-cache-"));
    const source = resolve(import.meta.dir, "..");
    const script = `
      const { recipesForHost } = await import(${JSON.stringify(join(source, "repo/recipes/index.ts"))});
      const { resolveHostPackage } = await import(${JSON.stringify(join(source, "host-resolve.ts"))});
      const hostRoot = process.argv[1];
      console.log(JSON.stringify(${expression}));
    `;
    const proc = Bun.spawn([process.execPath, "-e", script, root], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache },
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`probe failed (${code}): ${stderr}`);
    return { answer: JSON.parse(stdout), cached: readdirSync(cache) };
  }

  // Vacuous under a stray `/tmp/node_modules`: auto-install never engages there.
  test.skipIf(nodeModulesAbove(root))(
    "is offered no recipe, and nothing is fetched to decide",
    async () => {
      const { answer, cached } = await probe("recipesForHost(hostRoot).map((r) => r.id)");
      expect(answer).toEqual([]);
      expect(cached).toEqual([]);
    },
    60_000,
  );

  test.skipIf(nodeModulesAbove(root))(
    "has no package installed, and nothing is fetched to decide",
    async () => {
      const { answer, cached } = await probe('resolveHostPackage("is-odd/package.json", hostRoot)');
      expect(answer).toBeNull();
      expect(cached).toEqual([]);
    },
    60_000,
  );
});
