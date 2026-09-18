import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AssetsFileSchema,
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

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
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
  return (await readdir(dir).catch(() => [])).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".notes.json") && !f.endsWith(".annotations.json"),
  );
}

describe("velloo init", () => {
  test("a blank start reports the theme and library it actually used", async () => {
    const { exitCode, stdout, stderr } = await runInit(tmp, [
      "--non-interactive",
      "--no-connect",
      "--library=none",
      "--start=blank",
    ]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    expect(stdout).toMatch(/scaffolded .* \(none /);
    expect(stdout).not.toContain("Elsewhere");
    expect(stdout).toMatch(/Theme\s+Zinc/);
  }, 60_000);

  test("scaffolds a folder whose contents parse against every schema", async () => {
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
    expect(config.defaultBoard).toBe("main");
    expect(config.boardOrder).toEqual(["main", "elsewhere-details"]);
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

    const assets = AssetsFileSchema.parse(
      JSON.parse(await readFile(join(design, "assets.json"), "utf8")),
    );
    expect(Object.keys(assets.generated).length).toBeGreaterThan(0);
    for (const [path, metadata] of Object.entries(assets.generated)) {
      expect(metadata.prompt.length).toBeGreaterThan(0);
      expect((await readFile(join(design, path))).byteLength).toBeGreaterThan(0);
    }
    expect(await readFile(join(design, "theme/custom.css"), "utf8")).toContain("ew-photo-shade");
    expect(
      JSON.parse(await readFile(join(design, "boards/elsewhere-details.notes.json"), "utf8"))
        .length,
    ).toBeGreaterThan(0);

    // A .gitignore keeps daemon runtime state + trace tapes out of git.
    const gitignore = await readFile(join(design, ".gitignore"), "utf8");
    expect(gitignore).toContain(".design/cache/");
    expect(gitignore).toContain(".velloo/");
    // The old empty-dir placeholder is gone — the dir is ignored, not tracked.
    expect(await Bun.file(join(design, ".design/cache/.gitkeep")).exists()).toBe(false);
  }, 30_000);

  test("--design-folder controls where the design lands under the app root", async () => {
    const { exitCode } = await runInit(tmp, ["--design-folder=design", "--initial-content=blank"]);
    expect(exitCode).toBe(0);
    expect(await Bun.file(join(tmp, "design", ".design/config.json")).exists()).toBe(true);
  }, 30_000);

  test("lists the design in the repo's velloo.json and merges a second one", async () => {
    const first = await runInit(tmp, ["--initial-content=blank"]);
    expect(first.exitCode).toBe(0);
    const manifestPath = join(tmp, "velloo.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.designs).toEqual(["velloo"]);
    const config = JSON.parse(await readFile(join(tmp, "velloo/.design/config.json"), "utf8"));
    expect(config.name).toBe("velloo");

    const second = await runInit(tmp, [
      "--design-folder=brand",
      "--name=marketing",
      "--initial-content=blank",
    ]);
    expect(second.exitCode).toBe(0);
    const merged = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(merged.designs).toEqual(["velloo", "brand"]);
    const brand = JSON.parse(await readFile(join(tmp, "brand/.design/config.json"), "utf8"));
    expect(brand.name).toBe("marketing");
  }, 60_000);

  test("refuses to scaffold over a non-empty design folder without --force", async () => {
    await Bun.write(join(designDir(tmp), "marker.txt"), "stay");
    const { exitCode, stderr } = await runInit(tmp);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not empty");
  }, 30_000);

  test("writes a README and records the planned in-repo component source", async () => {
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

  test("persists hostApp.root pointing from the design folder to the app root", async () => {
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

  test("blank initial content produces zero boards, zero screens, and a neutral theme", async () => {
    const { exitCode } = await runInit(tmp, ["--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.defaultScreen).toBeUndefined();
    expect((await jsonFiles(join(design, "screens"))).length).toBe(0);
    expect((await jsonFiles(join(design, "boards"))).length).toBe(0);
    // Neutral zinc default — not the welcome-sample green.
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).not.toContain("5e6ad2");
  }, 30_000);

  test("theme preset is reflected in the generated theme", async () => {
    const { exitCode } = await runInit(tmp, ["--theme-preset=violet", "--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(tmp), "theme/default.json"), "utf8")),
    );
    // Violet derives a distinctly higher-chroma primary than the sample indigo default.
    expect(JSON.stringify(theme.colors.primary)).not.toContain("5e6ad2");
  }, 30_000);

  test("--stack sets the codegen alias; the sample always ships whole", async () => {
    const { exitCode, stderr } = await runInit(tmp, ["--theme-preset=rose", "--stack=remix"]);
    if (exitCode !== 0) throw new Error(stderr);
    const design = designDir(tmp);

    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "elsewhere-details.json",
      "main.json",
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

  test("upstream never writes into the app during init (deferred)", async () => {
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

  test("--library=mui scaffolds a MUI folder with a seven-screen sx sample", async () => {
    const { exitCode } = await runInit(tmp, ["--library=mui"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("mui");
    expect(config.libraries.default?.source).toBe("binary");

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("elsewhere-discover.json");
    expect(screenFiles).toContain("elsewhere-trips-library.json");
    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "elsewhere-details.json",
      "main.json",
    ]);

    // The sample uses MUI component ids + sx styling, not shadcn refs/classNames.
    const welcome = JSON.parse(
      await readFile(join(design, "screens/elsewhere-discover.json"), "utf8"),
    );
    const json = JSON.stringify(welcome);
    expect(json).toContain('"Typography"');
    expect(json).toContain('"sx"');
    expect(json).not.toContain('"className"');

    // The README hands off the app-level MUI install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install @mui/material @emotion/react @emotion/styled");
  }, 30_000);

  test("--library=antd scaffolds an antd folder with a seven-screen inline-style sample", async () => {
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
    expect(screenFiles).toContain("elsewhere-discover.json");
    expect(screenFiles).toContain("elsewhere-trips-library.json");
    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "elsewhere-details.json",
      "main.json",
    ]);

    // The sample uses antd component ids + inline style objects, not shadcn
    // refs/classNames or sx.
    const welcome = JSON.parse(
      await readFile(join(design, "screens/elsewhere-discover.json"), "utf8"),
    );
    const json = JSON.stringify(welcome);
    expect(json).toContain('"TypographyTitle"');
    expect(json).toContain('"style"');
    expect(json).not.toContain('"className"');
    expect(json).not.toContain('"sx"');

    // The README hands off the app-level antd install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install antd");
  }, 30_000);

  test("--library=chakra scaffolds a chakra folder with a seven-screen sx sample", async () => {
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
    expect(screenFiles).toContain("elsewhere-discover.json");
    expect(screenFiles).toContain("elsewhere-trips-library.json");
    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "elsewhere-details.json",
      "main.json",
    ]);

    // The sample uses chakra component ids + sx objects, not shadcn
    // refs/classNames or inline styles.
    const welcome = JSON.parse(
      await readFile(join(design, "screens/elsewhere-discover.json"), "utf8"),
    );
    const json = JSON.stringify(welcome);
    expect(json).toContain('"Heading"');
    expect(json).toContain('"sx"');
    expect(json).not.toContain('"className"');

    // The README hands off the app-level chakra install (for the emitted code).
    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme).toContain("npm install @chakra-ui/react@2 @emotion/react @emotion/styled");
  }, 30_000);

  test("--library=none ships bare primitives with a seven-screen sample", async () => {
    const { exitCode } = await runInit(tmp, ["--library=none"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
    expect(config.libraries.default?.source).toBe("binary");

    const screenFiles = await jsonFiles(join(design, "screens"));
    expect(screenFiles).toContain("elsewhere-discover.json");
    expect(screenFiles).toContain("elsewhere-trips-board.json");
    expect((await jsonFiles(join(design, "boards"))).sort()).toEqual([
      "elsewhere-details.json",
      "main.json",
    ]);

    const readme = await readFile(join(design, "README.md"), "utf8");
    expect(readme.toLowerCase()).toContain("no-library");
  }, 30_000);

  test("--library=shadcn-upstream works offline with a blank folder", async () => {
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

  test("--start=scan generates one screen per Next.js app-router route", async () => {
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

  test("--start=scan picks up Vite-style src/routes/ files", async () => {
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

  test("--start=scan creates a root screen for a plain Vite SPA", async () => {
    const app = join(tmp, "vite-spa");
    await mkdir(join(app, "src"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({
        dependencies: { react: "19.2.6", "@mantine/core": "^8.0.0" },
        devDependencies: { vite: "^7.0.0" },
      }),
    );
    await writeFile(
      join(app, "index.html"),
      '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
    );
    await writeFile(join(app, "src", "main.jsx"), 'import App from "./App.jsx";');

    const { exitCode, stderr } = await runInit(app, ["--start=scan"]);
    if (exitCode !== 0) throw new Error(stderr);

    expect(await jsonFiles(join(designDir(app), "screens"))).toEqual(["index.json"]);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designDir(app), ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
  }, 30_000);

  test("blank init detects an installed unsupported UI framework without creating screens", async () => {
    const app = join(tmp, "mantine-blank");
    await mkdir(app, { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.6", "@mantine/core": "^8.0.0" } }),
    );

    const { exitCode, stderr } = await runInit(app, ["--initial-content=blank"]);
    if (exitCode !== 0) throw new Error(stderr);

    const design = designDir(app);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
    expect(await jsonFiles(join(design, "screens"))).toEqual([]);
    expect(await jsonFiles(join(design, "boards"))).toEqual([]);
  }, 30_000);

  test("--start=scan degrades to a true blank when no routes are detectable", async () => {
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

  test("--start=scan imports the host theme from globals.css", async () => {
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

  test("--start=redesign-screen scaffolds one named screen with desktop+mobile frames", async () => {
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

  test("--start=custom scaffolds an empty Main board and embeds the request", async () => {
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
