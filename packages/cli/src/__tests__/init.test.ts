import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  CURRENT_SCHEMA_VERSION,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "@velloo/schema";

/**
 * End-to-end CLI smoke: run `velloo init` as a subprocess and confirm the
 * scaffold matches every schema we ship. The positional arg is the APP ROOT;
 * the design folder lands at `<appRoot>/velloo` by default. This is the only
 * test that exercises the full CLI surface; if it breaks, onboarding is broken.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

/**
 * These run concurrently — each case is a full `velloo init` subprocess, and
 * 21 of them in sequence was the slowest file in the suite by a wide margin.
 * That means no shared scaffold: every test owns an app root nobody else can
 * see, and teardown waits until they have all finished.
 */
const roots: string[] = [];

function appRoot(): string {
  const root = join(
    tmpdir(),
    `velloo-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  roots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** Where the design folder lands for an app root + optional --design-folder. */
function designDir(appRoot: string, name = "velloo"): string {
  return join(appRoot, name);
}

async function runInit(appRoot: string, extraArgs: string[] = []) {
  const proc = Bun.spawn(["bun", cliPath, "init", appRoot, ...extraArgs], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
    // Isolate $HOME: the default agent wiring installs the Claude plugin
    // under ~/.velloo and registers it in ~/.claude/settings.json — tests
    // must never write into the developer's real home.
    env: { ...process.env, HOME: join(appRoot, "fake-home") },
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

async function jsonFiles(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
}

describe("velloo init", () => {
  test.concurrent("scaffolds a folder whose contents parse against every schema", async () => {
    const tmp = appRoot();
    const { exitCode, stdout, stderr } = await runInit(tmp);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    expect(stdout).toContain("scaffolded");
    const design = designDir(tmp);

    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(config.defaultLibrary).toBe("default");
    expect(config.libraries.default?.id).toBe("shadcn-upstream");
    expect(config.defaultBoard).toBeUndefined();
    expect(config.defaultScreen).toBeDefined();

    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")),
    );
    expect(theme.name).toBeDefined();

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles.length).toBeGreaterThan(0);
    for (const f of screenFiles)
      ScreenSchema.parse(JSON.parse(await readFile(join(design, "screens", f), "utf8")));

    const boardFiles = await jsonFiles(join(design, "boards"));
    expect(boardFiles.length).toBeGreaterThan(0);
    for (const f of boardFiles)
      BoardSchema.parse(JSON.parse(await readFile(join(design, "boards", f), "utf8")));

    const snippetFiles = await jsonFiles(join(design, "snippets"));
    expect(snippetFiles.length).toBeGreaterThan(0);
    for (const f of snippetFiles)
      SnippetSchema.parse(JSON.parse(await readFile(join(design, "snippets", f), "utf8")));

    // A .gitignore keeps daemon runtime state + trace tapes out of git.
    const gitignore = await readFile(join(design, ".gitignore"), "utf8");
    expect(gitignore).toContain(".design/cache/");
    expect(gitignore).toContain(".velloo/");
    // The old empty-dir placeholder is gone — the dir is ignored, not tracked.
    expect(await Bun.file(join(design, ".design/cache/.gitkeep")).exists()).toBe(false);
  }, 30_000);

  test.concurrent("--design-folder controls where the design lands under the app root", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--design-folder=design", "--initial-content=blank"]);
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(tmp, "design", ".design/config.json")).exists()).toBe(true);
  }, 30_000);

  test.concurrent("registers the folder in the repo's velloo.json and merges a second project", async () => {
    const tmp = appRoot();
    const first = await runInit(tmp, ["--initial-content=blank"]);
    expect(first.exitCode).toBe(0);
    const manifestPath = join(tmp, "velloo.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(Object.values(manifest.projects)).toEqual(["velloo"]);

    const second = await runInit(tmp, [
      "--design-folder=brand",
      "--project=brand",
      "--initial-content=blank",
    ]);
    expect(second.exitCode).toBe(0);
    const merged = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(merged.projects.brand).toBe("brand");
    expect(Object.keys(merged.projects)).toHaveLength(2);
  }, 60_000);

  test.concurrent("refuses to scaffold over a non-empty design folder without --force", async () => {
    const tmp = appRoot();
    await Bun.write(join(designDir(tmp), "marker.txt"), "stay");
    const { exitCode, stderr } = await runInit(tmp);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not empty");
  }, 30_000);

  test.concurrent("writes a README and records the planned in-repo component source", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.source).toBe("in-repo");
    expect(config.libraries.default?.componentsPath).toBe("../src/components");

    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("Velloo design folder");
    expect(readme).toContain("shadcn");
  }, 30_000);

  test.concurrent("persists hostApp.root pointing from the design folder to the app root", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designDir(tmp), ".design/config.json"), "utf8")),
    );
    // Design folder is <appRoot>/velloo, so the host app root is one level up;
    // the live-island bundler resolves this against the design folder root.
    expect(config.hostApp?.root).toBe("..");
    expect(config.hostApp?.aliases).toEqual({ "@/*": "src/*" });
  }, 30_000);

  test.concurrent("blank initial content produces zero boards, zero screens, and a neutral theme", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.defaultScreen).toBeUndefined();
    expect((await jsonFiles(join(design, "screens"))).length).toBe(0);
    expect((await jsonFiles(join(design, "boards"))).length).toBe(0);
    // Neutral zinc default — not the welcome-sample indigo.
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).not.toContain("5e6ad2");
  }, 30_000);

  test.concurrent("theme preset is reflected in the generated theme", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--theme-preset=violet", "--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(tmp), "theme/default.json"), "utf8")),
    );
    // Violet derives a distinctly higher-chroma primary than the sample indigo default.
    expect(JSON.stringify(theme.colors.primary)).not.toContain("5e6ad2");
  }, 30_000);

  test.concurrent("--stack sets the codegen alias; the sample always ships whole", async () => {
    const tmp = appRoot();
    const { exitCode, stderr } = await runInit(tmp, ["--theme-preset=rose", "--stack=remix"]);
    if (exitCode !== 0) throw new Error(stderr);
    const design = designDir(tmp);

    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "app.json",
      "marketing.json",
      "playground.json",
    ]);

    // The remix stack lands as the codegen import alias.
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.codegen?.componentsAlias).toBe("~/components/ui");

    // Rose preset derives its own primary (not the sample indigo default).
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).not.toContain("5e6ad2");
  }, 30_000);

  test.concurrent("upstream never writes into the app during init (deferred)", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, [
      "--library=shadcn-upstream",
      "--components-dir=src/components/ui",
      "--initial-content=blank",
    ]);
    expect(exitCode).toBe(0);

    // Nothing landed in the app's component dir — install is deferred.
    expect(await Bun.file(join(tmp, "src/components/ui/button.tsx")).exists()).toBe(false);

    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("shadcn-upstream");
    expect(config.libraries.default?.source).toBe("in-repo");

    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("Bringing shadcn into your app");
  }, 30_000);

  test.concurrent("--library=mui scaffolds a MUI folder with a two-screen sx sample", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--library=mui"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("mui");
    expect(config.libraries.default?.source).toBe("binary");

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("welcome.json");
    expect(screenFiles).toContain("signup.json");
    expect(await jsonFiles(join(design, "boards"))).toEqual(["main.json"]);

    // The sample uses MUI component ids + sx styling, not shadcn refs/classNames.
    const welcome = JSON.parse(await readFile(join(design, "screens/welcome.json"), "utf8"));
    const json = JSON.stringify(welcome);
    expect(json).toContain('"Typography"');
    expect(json).toContain('"sx"');
    expect(json).not.toContain('"className"');

    // The README hands off the app-level MUI install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install @mui/material @emotion/react @emotion/styled");
  }, 30_000);

  test.concurrent("--library=antd scaffolds an antd folder with a two-screen inline-style sample", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--library=antd"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("antd");
    expect(config.libraries.default?.source).toBe("binary");
    // The style channel is intrinsic (inline style) — no CSS-framework axis.
    expect(config.styling).toBeUndefined();

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("welcome.json");
    expect(screenFiles).toContain("signup.json");
    expect(await jsonFiles(join(design, "boards"))).toEqual(["main.json"]);

    // The sample uses antd component ids + inline style objects, not shadcn
    // refs/classNames or sx.
    const welcome = JSON.parse(await readFile(join(design, "screens/welcome.json"), "utf8"));
    const json = JSON.stringify(welcome);
    expect(json).toContain('"TypographyTitle"');
    expect(json).toContain('"style"');
    expect(json).not.toContain('"className"');
    expect(json).not.toContain('"sx"');

    // The README hands off the app-level antd install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install antd");
  }, 30_000);

  test.concurrent("--library=chakra scaffolds a chakra folder with a two-screen sx sample", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--library=chakra"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("chakra");
    expect(config.libraries.default?.source).toBe("binary");
    // The style channel is intrinsic (sx, like MUI) — no CSS-framework axis.
    expect(config.styling).toBeUndefined();

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("welcome.json");
    expect(screenFiles).toContain("signup.json");
    expect(await jsonFiles(join(design, "boards"))).toEqual(["main.json"]);

    // The sample uses chakra component ids + sx objects, not shadcn
    // refs/classNames or inline styles.
    const welcome = JSON.parse(await readFile(join(design, "screens/welcome.json"), "utf8"));
    const json = JSON.stringify(welcome);
    expect(json).toContain('"Heading"');
    expect(json).toContain('"sx"');
    expect(json).not.toContain('"className"');
    expect(json).not.toContain('"style"');

    // The README hands off the app-level chakra install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install @chakra-ui/react@2 @emotion/react @emotion/styled");
  }, 30_000);

  test.concurrent("--library=none ships bare primitives with a two-screen sample", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, ["--library=none"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
    expect(config.libraries.default?.source).toBe("binary");

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("welcome.json");
    expect(screenFiles).toContain("form.json");
    expect(await jsonFiles(join(design, "boards"))).toEqual(["main.json"]);

    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme.toLowerCase()).toContain("no-library");
  }, 30_000);

  test.concurrent("--library=shadcn-upstream works offline with a blank folder", async () => {
    const tmp = appRoot();
    const { exitCode } = await runInit(tmp, [
      "--library=shadcn-upstream",
      "--initial-content=blank",
    ]);
    expect(exitCode).toBe(0);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designDir(tmp), ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("shadcn-upstream");
    expect(config.libraries.default?.source).toBe("in-repo");
  }, 30_000);

  test.concurrent("--start=scan generates one screen per Next.js app-router route", async () => {
    const tmp = appRoot();
    const app = join(tmp, "next-app");
    await mkdir(join(app, "app", "dashboard"), { recursive: true });
    await mkdir(join(app, "app", "settings", "account"), { recursive: true });
    await mkdir(join(app, "app", "blog", "[slug]"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", react: "19.2.6" } }),
    );
    for (const p of ["app", "app/dashboard", "app/settings/account", "app/blog/[slug]"]) {
      await writeFile(join(app, p, "page.tsx"), "export default function P(){return null}");
    }

    const { exitCode, stderr } = await runInit(app, ["--start=scan"]);
    if (exitCode !== 0) throw new Error(stderr);
    const design = designDir(app);

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("index.json");
    expect(screenFiles).toContain("dashboard.json");
    expect(screenFiles).toContain("settings-account.json");
    expect(screenFiles).toContain("blog-slug.json");
    expect(await jsonFiles(join(design, "boards"))).toEqual(["app.json"]);

    const dashboard = JSON.parse(await readFile(join(design, "screens", "dashboard.json"), "utf8"));
    expect(dashboard.name).toBe("Dashboard");
    expect(JSON.stringify(dashboard)).toContain("/dashboard");
  }, 30_000);

  test.concurrent("--start=scan picks up Vite-style src/routes/ files", async () => {
    const tmp = appRoot();
    const app = join(tmp, "vite-app");
    await mkdir(join(app, "src", "routes", "settings"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { vite: "5.0.0", react: "19.2.6" } }),
    );
    await writeFile(
      join(app, "src", "routes", "index.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(app, "src", "routes", "about.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(app, "src", "routes", "settings", "profile.tsx"),
      "export default function P(){return null}",
    );

    const { exitCode } = await runInit(app, ["--start=scan"]);
    expect(exitCode).toBe(0);
    const screenFiles = await jsonFiles(join(designDir(app), "screens"));
    expect(screenFiles).toContain("index.json");
    expect(screenFiles).toContain("about.json");
    expect(screenFiles).toContain("settings-profile.json");
  }, 30_000);

  test.concurrent("--start=scan degrades to a true blank when no routes are detectable", async () => {
    const tmp = appRoot();
    const app = join(tmp, "empty-app");
    await mkdir(app, { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.6" } }),
    );

    const { exitCode, stdout } = await runInit(app, ["--start=scan"]);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("no routes detected");
    expect((await jsonFiles(join(designDir(app), "screens"))).length).toBe(0);
    expect((await jsonFiles(join(designDir(app), "boards"))).length).toBe(0);
  }, 30_000);

  test.concurrent("--start=scan imports the host theme from globals.css", async () => {
    const tmp = appRoot();
    const app = join(tmp, "themed-app");
    await mkdir(join(app, "app"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", tailwindcss: "^4.0.0" } }),
    );
    await writeFile(join(app, "app", "page.tsx"), "export default function P(){return null}");
    await writeFile(
      join(app, "app", "globals.css"),
      '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25);--radius: 0.75rem;}\n',
    );

    const { exitCode, stdout } = await runInit(app, ["--start=scan"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Imported your theme");

    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(app), "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).toContain("oklch(0.6 0.2 25)");
    expect(theme.radius.md).toBe("0.75rem");
  }, 30_000);

  test.concurrent("--start=redesign-screen scaffolds one named screen with desktop+mobile frames", async () => {
    const tmp = appRoot();
    const { exitCode, stdout } = await runInit(tmp, [
      "--start=redesign-screen",
      "--screen-name=Pricing",
      "--no-connect",
    ]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    expect(await jsonFiles(join(design, "screens"))).toEqual(["pricing.json"]);
    expect(await jsonFiles(join(design, "boards"))).toEqual(["main.json"]);
    const board = BoardSchema.parse(
      JSON.parse(await readFile(join(design, "boards/main.json"), "utf8")),
    );
    expect(board.frames).toHaveLength(2);
    expect(board.frames.every((f) => f.screen === "pricing")).toBe(true);
    expect(stdout.toLowerCase()).toContain("explore alternatives");
  }, 30_000);

  test.concurrent("--start=custom scaffolds an empty Main board and embeds the request", async () => {
    const tmp = appRoot();
    const { exitCode, stdout } = await runInit(tmp, [
      "--start=custom",
      "--request=a settings page with dark mode",
      "--no-connect",
    ]);
    expect(exitCode).toBe(0);
    expect((await jsonFiles(join(designDir(tmp), "boards"))).length).toBe(1);
    expect((await jsonFiles(join(designDir(tmp), "screens"))).length).toBe(0);
    expect(stdout).toContain("a settings page with dark mode");
  }, 30_000);
});
