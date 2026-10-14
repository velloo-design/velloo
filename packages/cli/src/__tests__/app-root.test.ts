import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "@velloo/schema";
import { designConfig, designTheme } from "@velloo/server/testing";
import {
  applyAppRootChange,
  appRootIsNotAnApp,
  planAppRootChange,
  recordedAppRoot,
} from "../app-root.ts";

/**
 * The repair for a folder whose recorded application is wrong — the gap that
 * left `.design/config.json` (declared tool-owned) as the only way to fix a
 * mis-scaffolded folder.
 */

let root: string;

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

/** A monorepo: a root that is not an app, holding one that is. */
async function monorepo(): Promise<{ repo: string; app: string }> {
  const repo = join(root, "repo");
  const app = join(repo, "packages", "web");
  await mkdir(join(app, "src"), { recursive: true });
  await writeJson(join(repo, "package.json"), { name: "repo", workspaces: ["packages/*"] });
  await writeJson(join(app, "package.json"), {
    name: "web",
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  });
  await writeFile(join(app, "src", "App.tsx"), "export default function App() { return null; }\n");
  return { repo, app };
}

async function designFolder(at: string, config = designConfig()): Promise<string> {
  await mkdir(join(at, ".design"), { recursive: true });
  await mkdir(join(at, "theme"), { recursive: true });
  await writeJson(join(at, ".design", "config.json"), config);
  await writeJson(join(at, "theme", "default.json"), designTheme());
  return at;
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "velloo-approot-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("recordedAppRoot reports a host app that no longer exists rather than throwing", async () => {
  const { repo } = await monorepo();
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({ hostApp: { root: "../gone" } }),
  );

  const recorded = await recordedAppRoot(folder);
  expect(recorded.kind).toBe("in-repo");
  expect(recorded.path).toBe(join(repo, "gone"));
  expect(recorded.exists).toBe(false);
  expect(recorded.looksLikeApp).toBe(false);
});

test("a root with no package.json reads as recorded-but-not-an-app", async () => {
  const { repo } = await monorepo();
  await mkdir(join(repo, "docs"), { recursive: true });
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({ hostApp: { root: "../docs" } }),
  );

  const recorded = await recordedAppRoot(folder);
  expect(recorded.exists).toBe(true);
  expect(recorded.looksLikeApp).toBe(false);
});

test("re-anchoring moves every path that was under the old application", async () => {
  const { repo, app } = await monorepo();
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({
      hostApp: { root: "..", aliases: { "@/*": "src/*" } },
      library: { source: "in-repo", componentsPath: "../src/components/ui" },
    }),
  );

  const change = await planAppRootChange(folder, app);
  expect(change.from).toBe(repo);
  expect(change.to).toBe(app);
  expect(change.rewritten).toEqual([
    { field: "hostApp.root", from: "..", to: "../packages/web" },
    {
      field: "libraries.default.componentsPath",
      from: "../src/components/ui",
      to: "../packages/web/src/components/ui",
    },
  ]);

  await applyAppRootChange(folder, change);
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
  );
  expect(config.hostApp?.root).toBe("../packages/web");
  // Re-anchoring is not a rewrite of everything: the alias map is a property
  // of the app, not a path into it.
  expect(config.hostApp?.aliases).toEqual({ "@/*": "src/*" });
  expect(config.libraries.default?.componentsPath).toBe("../packages/web/src/components/ui");
  expect((await recordedAppRoot(folder)).path).toBe(app);
});

test("paths outside the old application are left alone", async () => {
  const { repo, app } = await monorepo();
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({
      hostApp: { root: "../packages/web" },
      library: { source: "binary", componentsPath: "binary" },
    }),
  );

  const change = await planAppRootChange(folder, join(repo, "packages", "admin"));
  // `binary` is a sentinel, and the library is not `in-repo` anyway.
  expect(change.rewritten.map((r) => r.field)).toEqual(["hostApp.root"]);
  expect(change.from).toBe(app);
});

/**
 * A monorepo whose app is the `web` workspace, with a design that `init`
 * recorded from the repo root: every path in it is right about the disk and
 * written against the wrong application.
 */
async function recordedFromTheRepoRoot(): Promise<{ repo: string; web: string; folder: string }> {
  const repo = join(root, "repo");
  const web = join(repo, "web");
  await mkdir(join(web, "src", "components", "ui"), { recursive: true });
  await writeJson(join(repo, "package.json"), { name: "repo", workspaces: ["web"] });
  await writeJson(join(web, "package.json"), { name: "web", dependencies: { react: "^19.0.0" } });
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({
      hostApp: { root: "..", aliases: { "@/*": "web/src/*" } },
      library: { source: "in-repo", componentsPath: "../web/src/components" },
      codegen: { componentsAlias: "@/components/ui", componentsDir: "web/src/components/ui" },
    }),
  );
  return { repo, web, folder };
}

test("narrowing the root to a workspace keeps the paths that already point into it", async () => {
  const { web, folder } = await recordedFromTheRepoRoot();

  const change = await planAppRootChange(folder, web);
  expect(change.rewritten).toEqual([
    { field: "hostApp.root", from: "..", to: "../web" },
    // Relative to the application root, so it is the one that has to change.
    { field: 'hostApp.aliases["@/*"]', from: "web/src/*", to: "src/*" },
    { field: "codegen.componentsDir", from: "web/src/components/ui", to: "src/components/ui" },
  ]);

  await applyAppRootChange(folder, change);
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
  );
  expect(config.hostApp).toEqual({ root: "../web", aliases: { "@/*": "src/*" } });
  // Relative to the design folder, and the components have not moved.
  expect(config.libraries.default?.componentsPath).toBe("../web/src/components");
  expect(config.codegen?.componentsDir).toBe("src/components/ui");
});

test("widening the root back out is the same correction in reverse", async () => {
  const { repo, web, folder } = await recordedFromTheRepoRoot();
  await applyAppRootChange(folder, await planAppRootChange(folder, web));

  const change = await planAppRootChange(folder, repo);
  expect(change.rewritten).toEqual([
    { field: "hostApp.root", from: "../web", to: ".." },
    { field: 'hostApp.aliases["@/*"]', from: "src/*", to: "web/src/*" },
    { field: "codegen.componentsDir", from: "src/components/ui", to: "web/src/components/ui" },
  ]);
});

test("a path into a sibling of the new root stays on the files it names", async () => {
  const { repo, web } = await recordedFromTheRepoRoot();
  await mkdir(join(repo, "packages", "ui", "src"), { recursive: true });
  const folder = await designFolder(
    join(repo, "shared"),
    designConfig({
      hostApp: {
        root: "..",
        aliases: { "@ui/*": "packages/ui/src/*", "@/*": "web/src/*" },
        // A specifier is not a path, whatever the root is.
        components: { include: ["packages/ui/src"], exclude: ["@tabler/icons-react"] },
      },
      hostApps: { admin: { root: "../packages/ui" } },
      library: { source: "in-repo", componentsPath: "../packages/ui/src" },
    }),
  );

  const change = await planAppRootChange(folder, web);
  expect(change.rewritten).toEqual([
    { field: "hostApp.root", from: "..", to: "../web" },
    { field: 'hostApp.aliases["@ui/*"]', from: "packages/ui/src/*", to: "../packages/ui/src/*" },
    { field: 'hostApp.aliases["@/*"]', from: "web/src/*", to: "src/*" },
    { field: "hostApp.components.include[0]", from: "packages/ui/src", to: "../packages/ui/src" },
  ]);

  await applyAppRootChange(folder, change);
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
  );
  expect(config.hostApp).toEqual({
    root: "../web",
    aliases: { "@ui/*": "../packages/ui/src/*", "@/*": "src/*" },
    components: { include: ["../packages/ui/src"], exclude: ["@tabler/icons-react"] },
  });
  // Written from the design folder, and neither it nor the files have moved.
  expect(config.hostApps).toEqual({ admin: { root: "../packages/ui" } });
  expect(config.libraries.default?.componentsPath).toBe("../packages/ui/src");
});

test("between two unrelated applications, every path under the old one follows it", async () => {
  const { repo, app } = await monorepo();
  const admin = join(repo, "packages", "admin");
  await mkdir(join(app, "src", "widgets"), { recursive: true });
  await mkdir(admin, { recursive: true });
  const folder = await designFolder(
    join(repo, "velloo"),
    designConfig({
      hostApp: {
        root: "../packages/web",
        aliases: { "@/*": "src/*" },
        components: { include: ["src/widgets"] },
      },
      hostApps: { docs: { root: "../packages/web/docs" }, shared: { root: "../shared" } },
      library: { source: "in-repo", componentsPath: "../packages/web/src/components" },
    }),
  );

  const change = await planAppRootChange(folder, admin);
  // Nothing here is "the same tree from a different place": what was written
  // from the design folder is rewritten, what was written against the
  // application already moves with it, and a path outside it is not its to move.
  expect(change.rewritten).toEqual([
    { field: "hostApp.root", from: "../packages/web", to: "../packages/admin" },
    { field: "hostApps.docs.root", from: "../packages/web/docs", to: "../packages/admin/docs" },
    {
      field: "libraries.default.componentsPath",
      from: "../packages/web/src/components",
      to: "../packages/admin/src/components",
    },
  ]);

  await applyAppRootChange(folder, change);
  const config = ConfigSchema.parse(
    JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
  );
  expect(config.hostApp).toEqual({
    root: "../packages/admin",
    aliases: { "@/*": "src/*" },
    components: { include: ["src/widgets"] },
  });
  expect(config.hostApps).toEqual({
    docs: { root: "../packages/admin/docs" },
    shared: { root: "../shared" },
  });
  expect(config.libraries.default?.componentsPath).toBe("../packages/admin/src/components");
});

test("an alias onto the new root itself keeps its wildcard", async () => {
  const { web } = await recordedFromTheRepoRoot();
  const folder = await designFolder(
    join(root, "repo", "flat"),
    designConfig({ hostApp: { root: "..", aliases: { "~/*": "web/*" } } }),
  );

  const change = await planAppRootChange(folder, web);
  expect(change.rewritten).toContainEqual({
    field: 'hostApp.aliases["~/*"]',
    from: "web/*",
    to: "*",
  });
});

test("a local design moves only its machine record, leaving app: paths to follow", async () => {
  const { repo, app } = await monorepo();
  const designsHome = join(root, "designs");
  const previous = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = designsHome;
  try {
    const id = "aaaabbbbccccdddd";
    const folder = await designFolder(
      join(designsHome, id),
      designConfig({
        hostApp: { root: "app:." },
        library: { source: "in-repo", componentsPath: "app:src/components" },
      }),
    );
    await mkdir(join(designsHome, ".locations"), { recursive: true });
    await writeJson(join(designsHome, ".locations", `${id}.json`), {
      root: repo,
      appRoot: repo,
    });

    expect((await recordedAppRoot(folder)).kind).toBe("local");
    const change = await planAppRootChange(folder, app);
    expect(change.local).toEqual({ id, root: repo });
    // `app:` already means "under the application root", so nothing in the
    // design config needs rewriting for it to follow.
    expect(change.rewritten).toEqual([]);

    await applyAppRootChange(folder, change);
    expect((await recordedAppRoot(folder)).path).toBe(app);
    expect(existsSync(join(repo, "velloo.json"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.VELLOO_DESIGNS_HOME;
    else process.env.VELLOO_DESIGNS_HOME = previous;
  }
});

test("a local design's app: paths are rewritten when the files they name do not move", async () => {
  const { repo, web } = await recordedFromTheRepoRoot();
  const designsHome = join(root, "designs");
  const previous = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = designsHome;
  try {
    const id = "9999aaaa8888bbbb";
    const folder = await designFolder(
      join(designsHome, id),
      designConfig({
        hostApp: { root: "app:.", aliases: { "@/*": "web/src/*" } },
        library: { source: "in-repo", componentsPath: "app:web/src/components" },
      }),
    );
    await mkdir(join(designsHome, ".locations"), { recursive: true });
    await writeJson(join(designsHome, ".locations", `${id}.json`), { root: repo, appRoot: repo });

    const change = await planAppRootChange(folder, web);
    expect(change.local).toEqual({ id, root: repo });
    expect(change.rewritten).toEqual([
      {
        field: "libraries.default.componentsPath",
        from: "app:web/src/components",
        to: "app:src/components",
      },
      { field: 'hostApp.aliases["@/*"]', from: "web/src/*", to: "src/*" },
    ]);

    await applyAppRootChange(folder, change);
    expect((await recordedAppRoot(folder)).path).toBe(web);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8")),
    );
    expect(config.hostApp).toEqual({ root: "app:.", aliases: { "@/*": "src/*" } });
    expect(config.libraries.default?.componentsPath).toBe("app:src/components");
  } finally {
    if (previous === undefined) delete process.env.VELLOO_DESIGNS_HOME;
    else process.env.VELLOO_DESIGNS_HOME = previous;
  }
});

test("a local design's application root must stay inside its checkout", async () => {
  const { repo } = await monorepo();
  const designsHome = join(root, "designs");
  const previous = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = designsHome;
  try {
    const id = "eeeeffff11112222";
    const folder = await designFolder(join(designsHome, id));
    await mkdir(join(designsHome, ".locations"), { recursive: true });
    await writeJson(join(designsHome, ".locations", `${id}.json`), {
      root: repo,
      appRoot: repo,
    });

    await expect(planAppRootChange(folder, root)).rejects.toThrow(/inside the design's checkout/);
  } finally {
    if (previous === undefined) delete process.env.VELLOO_DESIGNS_HOME;
    else process.env.VELLOO_DESIGNS_HOME = previous;
  }
});

test("a monorepo root that holds apps but is not one is flagged for init", async () => {
  const { repo, app } = await monorepo();
  const candidates = await appRootIsNotAnApp(repo);
  expect(candidates?.map((c) => c.dir)).toEqual([app]);
  // The app itself is a legitimate answer, so init has nothing to ask about.
  expect(await appRootIsNotAnApp(app)).toBeNull();
});
