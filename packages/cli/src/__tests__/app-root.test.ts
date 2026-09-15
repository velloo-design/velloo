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

test("a local design moves only its machine record, leaving project: paths to follow", async () => {
  const { repo, app } = await monorepo();
  const designsHome = join(root, "designs");
  const previous = process.env.VELLOO_DESIGNS_HOME;
  process.env.VELLOO_DESIGNS_HOME = designsHome;
  try {
    const id = "aaaabbbbccccdddd";
    const folder = await designFolder(
      join(designsHome, id),
      designConfig({
        hostApp: { root: "project:." },
        library: { source: "in-repo", componentsPath: "project:src/components" },
      }),
    );
    await mkdir(join(designsHome, ".locations"), { recursive: true });
    await writeJson(join(designsHome, ".locations", `${id}.json`), {
      root: repo,
      appRoot: repo,
      projectName: "web",
    });

    expect((await recordedAppRoot(folder)).kind).toBe("local");
    const change = await planAppRootChange(folder, app);
    expect(change.local).toEqual({ id, root: repo, project: "web" });
    // `project:` already means "under the application root", so nothing in the
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
      projectName: "web",
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
