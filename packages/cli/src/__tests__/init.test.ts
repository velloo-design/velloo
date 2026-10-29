import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
    await mkdir(tmp, { recursive: true });
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "@acme/dine-dash" }));
    const first = await runInit(tmp, ["--initial-content=blank"]);
    expect(first.exitCode).toBe(0);
    const manifestPath = join(tmp, "velloo.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.designs).toEqual(["velloo"]);
    const config = JSON.parse(await readFile(join(tmp, "velloo/.design/config.json"), "utf8"));
    // Named for the app, not the default `velloo` folder it sits in.
    expect(config.name).toBe("dine-dash");

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

  test("--library=html starts with an editable native HTML/htmx screen", async () => {
    const { exitCode } = await runInit(tmp, ["--library=html"]);
    expect(exitCode).toBe(0);
    const design = designDir(tmp);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("html");
    const screen = ScreenSchema.parse(
      JSON.parse(await readFile(join(design, "screens/contacts.json"), "utf8")),
    );
    expect("$ref" in screen.tree && screen.tree.$ref).toBe("Html");
    expect(JSON.stringify(screen.tree)).toContain('"hx-get":"/contacts/search"');
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

  test("--start=scan adopts the HTML adapter for a Flask + htmx app", async () => {
    const app = join(tmp, "flask-app");
    await mkdir(join(app, "templates"), { recursive: true });
    await writeFile(join(app, "requirements.txt"), "Flask==3.1.0\n");
    await writeFile(
      join(app, "app.py"),
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        '@app.route("/contacts")',
        "def contacts(): ...",
        '@app.route("/contacts/<int:contact_id>")',
        "def contact(contact_id): ...",
        "app.run(port=5123)",
      ].join("\n"),
    );
    await writeFile(
      join(app, "templates", "layout.html"),
      '<link rel="stylesheet" href="/static/site.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><main hx-boost="true"></main>',
    );
    await mkdir(join(app, "static"), { recursive: true });
    await writeFile(join(app, "static", "site.css"), "main { color: rgb(1, 2, 3); }");

    const { exitCode, stderr } = await runInit(app, ["--start=scan"]);
    if (exitCode !== 0) throw new Error(stderr);
    const design = designDir(app);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("html");
    expect(config.styling?.framework).toBe("none");
    // Styled like the app from the first screen, with no app running: the
    // stylesheets its templates link, copied from its source.
    expect(config.hostApp).toMatchObject({ stylesheets: ["/static/site.css"] });
    expect(config.hostApp).not.toHaveProperty("previewUrl");
    expect(await readFile(join(design, "assets/host/static/site.css"), "utf8")).toBe(
      "main { color: rgb(1, 2, 3); }",
    );
    const contacts = ScreenSchema.parse(
      JSON.parse(await readFile(join(design, "screens", "contacts.json"), "utf8")),
    );
    // The agent's placeholder, rebuilt from a capture of the route.
    expect(contacts.tree).toMatchObject({ $ref: "Html", props: { as: "main" } });
    expect(JSON.stringify(contacts.tree)).toContain("start_capture_session");
    // Native HTML imports nothing, so no stack alias rides along.
    expect(config.hostApp?.aliases).toBeUndefined();
    expect(config.codegen?.componentsAlias).toBeUndefined();
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

    const { exitCode, stdout, stderr } = await runInit(app, ["--initial-content=blank"]);
    if (exitCode !== 0) throw new Error(stderr);

    const design = designDir(app);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(design, ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
    expect(await jsonFiles(join(design, "screens"))).toEqual([]);
    expect(await jsonFiles(join(design, "boards"))).toEqual([]);

    // It sets no theme, so it is on Mantine's own — and so is the design, said as that.
    expect(stdout).toContain(
      "Your app sets no Mantine theme, so the design starts on Mantine's own",
    );
    expect(stdout).toMatch(/Theme\s+Mantine's default theme\n/);
    expect(stdout).not.toContain("Imported your theme");
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(design, "theme/default.json"), "utf8")),
    );
    expect(theme.colors.primary).toEqual({ DEFAULT: "#228be6", foreground: "#fff" });
  }, 30_000);

  test("an app with no UI library is a no-library design, styled the way the app is", async () => {
    // A Vite + React + Tailwind site with components of its own and no library:
    // shadcn here would be a design made of components the app does not have.
    const withTailwind = join(tmp, "plain-tailwind");
    const plain = join(tmp, "plain-css");
    for (const [app, devDependencies] of [
      [withTailwind, { tailwindcss: "^4.2.2", "@tailwindcss/vite": "^4.2.2" }],
      [plain, {}],
    ] as const) {
      await mkdir(join(app, "src"), { recursive: true });
      await writeFile(
        join(app, "package.json"),
        JSON.stringify({ dependencies: { react: "^18.3.1" }, devDependencies }),
      );
      await writeFile(join(app, "src/App.tsx"), "export default () => <main />;\n");
    }

    for (const start of ["blank", "custom"]) {
      const app = join(tmp, `plain-${start}`);
      await cp(withTailwind, app, { recursive: true });
      const { exitCode, stdout, stderr } = await runInit(app, [
        `--start=${start}`,
        "--request=a pricing page",
      ]);
      if (exitCode !== 0) throw new Error(stderr);
      const config = ConfigSchema.parse(
        JSON.parse(await readFile(join(designDir(app), ".design/config.json"), "utf8")),
      );
      expect(config.libraries.default?.id).toBe("none");
      expect(config.styling?.framework).toBe("tailwind");
      expect(stdout).toContain("the setup step finds the components your app has");
      expect(stdout).not.toContain("shadcn");
    }

    const { exitCode } = await runInit(plain, ["--start=blank"]);
    expect(exitCode).toBe(0);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designDir(plain), ".design/config.json"), "utf8")),
    );
    expect(config.libraries.default?.id).toBe("none");
    expect(config.styling?.framework).toBe("none");
  }, 60_000);

  test("with no app to read, the library is still the one asked for (or the default)", async () => {
    const { exitCode, stdout } = await runInit(tmp, ["--start=blank"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/scaffolded .* \(shadcn-upstream /);
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

  /** A Vite + shadcn app whose `components.json` names an entry stylesheet. */
  async function shadcnViteApp(name: string, sheets: Record<string, string>): Promise<string> {
    const app = join(tmp, name);
    await mkdir(join(app, "src", "styles"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" } }),
    );
    await writeFile(
      join(app, "components.json"),
      JSON.stringify({
        style: "new-york",
        tailwind: { css: "src/styles/index.css", cssVariables: true },
        aliases: { components: "@/components", ui: "@/components/ui" },
      }),
    );
    for (const [file, css] of Object.entries(sheets)) {
      await writeFile(join(app, "src", "styles", file), css);
    }
    return app;
  }

  test("imports the host theme from a sheet the global stylesheet @imports", async () => {
    const app = await shadcnViteApp("split-theme-app", {
      "index.css": "@import 'tailwindcss';\n@import 'tw-animate-css';\n@import './theme.css';\n",
      "theme.css":
        ":root{--primary: oklch(0.208 0.042 265.755);--radius: 0.625rem;}\n.dark{--primary: oklch(0.929 0.013 255.508);}\n",
    });

    const { exitCode, stdout, stderr } = await runInit(app, [
      "--non-interactive",
      "--no-connect",
      "--start=blank",
    ]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    // Paths are printed the way the platform writes them.
    const entry = join("src", "styles", "index.css");
    expect(stdout).toContain(
      `Imported your theme from ${entry} and the stylesheets it imports (${join("src", "styles", "theme.css")}).`,
    );
    expect(stdout).toMatch(/Theme\s+imported from /);
    expect(stdout).toContain(`imported from ${entry}\n`);

    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(app), "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).toContain("oklch(0.208 0.042 265.755)");
    expect(JSON.stringify(theme.colorsDark?.primary)).toContain("oklch(0.929 0.013 255.508)");
    expect(theme.radius.md).toBe("0.625rem");
  }, 30_000);

  test("says so when the stylesheet it found holds no tokens", async () => {
    const app = await shadcnViteApp("tokenless-app", {
      "index.css": "@import 'tailwindcss';\n@import '@acme/design-tokens/theme.css';\n",
    });

    const { exitCode, stdout, stderr } = await runInit(app, [
      "--non-interactive",
      "--no-connect",
      "--start=blank",
    ]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    expect(stdout).not.toContain("Imported your theme");
    const entry = join("src", "styles", "index.css");
    expect(stdout).toContain(`Found ${entry}, but no theme tokens`);
    expect(stdout).toContain("import_theme");
    expect(stdout).toContain(`Zinc (neutral) preset — no tokens found in ${entry}\n`);
  }, 30_000);

  /** A Next app with both a stylesheet and a DESIGN.md at its root. */
  async function designMdApp(name: string): Promise<string> {
    const app = join(tmp, name);
    await mkdir(join(app, "app"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", tailwindcss: "^4.0.0" } }),
    );
    await writeFile(join(app, "app", "page.tsx"), "export default function P(){return null}");
    // Both sources present: the DESIGN.md must win, because it is a design
    // system someone wrote down rather than one inferred from a stylesheet.
    await writeFile(
      join(app, "app", "globals.css"),
      '@import "tailwindcss";\n:root{--primary: oklch(0.6 0.2 25);}\n',
    );
    await writeFile(
      join(app, "DESIGN.md"),
      [
        "---",
        "name: Paws & Paths",
        "colors:",
        '  background: "#f9f9ff"',
        '  on-background: "#151c27"',
        '  primary: "#855300"',
        '  on-primary: "#ffffff"',
        '  outline: "#867461"',
        '  error: "#ba1a1a"',
        "rounded:",
        "  md: 0.75rem",
        "---",
        "",
        "## Brand & Style",
        "",
        "Optimistic, trustworthy, active.",
        "",
        "## Do's and Don'ts",
        "",
        "- Don't use more than one accent per screen.",
        "",
      ].join("\n"),
    );
    return app;
  }

  test("--start=scan prefers a DESIGN.md over the stylesheet, and follows the file", async () => {
    const app = await designMdApp("designmd-app");

    const { exitCode, stdout, stderr } = await runInit(app, ["--start=scan"]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    expect(stdout).toContain("Paws & Paths");
    expect(stdout).toContain("color roles mapped");

    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(app), "theme/default.json"), "utf8")),
    );
    // The DESIGN.md's primary, not the stylesheet's oklch one.
    expect(JSON.stringify(theme.colors.primary)).toContain("#855300");
    expect(theme.colors.background).toBe("#f9f9ff");
    expect(theme.colors.border).toBe("#867461");
    expect(theme.radius.md).toBe("0.75rem");

    // The folder records the file and reads it live. Nothing is copied in:
    // the DESIGN.md goes on being edited in the repo, and a snapshot would
    // drift away from the rules it states.
    const config = JSON.parse(
      await readFile(join(designDir(app), ".design/config.json"), "utf8"),
    ) as { designSystem?: { path: string } };
    expect(config.designSystem?.path).toBe("DESIGN.md");
    await expect(readFile(join(designDir(app), "guidance.md"), "utf8")).rejects.toThrow();
  }, 30_000);

  test("--no-design-md keeps the stylesheet path exactly as without one", async () => {
    const app = await designMdApp("designmd-declined");
    const { exitCode, stderr } = await runInit(app, ["--start=scan", "--no-design-md"]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    const theme = ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(app), "theme/default.json"), "utf8")),
    );
    expect(JSON.stringify(theme.colors.primary)).toContain("oklch(0.6 0.2 25)");
    const config = JSON.parse(
      await readFile(join(designDir(app), ".design/config.json"), "utf8"),
    ) as { designSystem?: unknown };
    expect(config.designSystem).toBeUndefined();
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
    expect(stdout).toContain("different directions beside it");
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

/**
 * Init reads from the app what it used to ask, and then says what it read:
 * the library, the theme and fonts it could import, what it left for setup,
 * and — where there is an app to match — that setup is the first step.
 */
describe("velloo init in an app", () => {
  interface AppFiles {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    files?: Record<string, string>;
  }

  const PAGE = "export default function Page() { return null; }\n";

  /** A React app under the test's directory; `at` places it below the directory init runs in. */
  async function reactApp(name: string, app: AppFiles = {}, at = "."): Promise<string> {
    const root = join(tmp, name);
    const dir = join(root, at);
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        dependencies: { react: "^19.0.0", ...app.dependencies },
        devDependencies: app.devDependencies ?? {},
      }),
      "src/App.tsx": "export default () => <main />;\n",
      ...app.files,
    };
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(resolve(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    return root;
  }

  async function init(appRoot: string, args: string[]): Promise<string> {
    const { exitCode, stdout, stderr } = await runInit(appRoot, ["--no-connect", ...args]);
    if (exitCode !== 0) throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    return stdout;
  }

  /** The numbered closing steps, as printed. */
  const closingSteps = (stdout: string): string[] =>
    stdout
      .slice(stdout.indexOf("How to use velloo"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+\. /.test(line));

  const readme = (appRoot: string) => readFile(join(designDir(appRoot), "README.md"), "utf8");

  async function library(appRoot: string): Promise<string | undefined> {
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designDir(appRoot), ".design/config.json"), "utf8")),
    );
    return config.libraries.default?.id;
  }

  const themeOf = async (appRoot: string) =>
    ThemeSchema.parse(
      JSON.parse(await readFile(join(designDir(appRoot), "theme/default.json"), "utf8")),
    );

  test("setup is the first step for the agent exactly when there is an app to match", async () => {
    const app = await reactApp("with-app");
    const empty = join(tmp, "no-app");
    const [withApp, withoutApp] = await Promise.all([
      init(app, ["--start=blank"]),
      init(empty, ["--start=blank", "--library=none"]),
    ]);

    const steps = closingSteps(withApp);
    expect(steps).toHaveLength(4);
    expect(steps[2]).toBe(
      "3. Ask your agent to set Velloo up for this app — /velloo:setup in Claude Code, or say it in any agent.",
    );
    // Before the canvas is opened: a design not yet matched is not the one to judge.
    expect(steps[3]).toStartWith("4. velloo run");
    expect(await readme(app)).toContain("## First: set it up for your app");

    expect(closingSteps(withoutApp)).toHaveLength(3);
    expect(withoutApp).not.toMatch(/sets? Velloo up/i);
    expect(withoutApp).not.toContain("/velloo:setup");
    expect(await readme(empty)).not.toContain("set it up for your app");
  }, 60_000);

  test("a start with a prompt for the agent says the setup once, in the prompt", async () => {
    const app = await reactApp("handoff-app");
    const empty = join(tmp, "handoff-no-app");
    const request = ["--start=custom", "--request=a pricing page"];
    const [withApp, withoutApp] = await Promise.all([init(app, request), init(empty, request)]);

    expect(withApp).toContain(
      "1. Set Velloo up for my app (theme, fonts, components) before anything else.",
    );
    expect(closingSteps(withApp)[2]).toBe(
      "3. Give your agent the prompt above — it sets Velloo up for this app first, then starts on the design.",
    );
    expect(withApp).not.toContain("/velloo:setup");
    // The README is read later, without the prompt beside it, and still says it.
    expect(await readme(app)).toContain("## First: set it up for your app");

    expect(withoutApp).toContain("a pricing page");
    expect(closingSteps(withoutApp)[2]).toBe("3. Give your agent the prompt above.");
    expect(withoutApp).not.toMatch(/sets? Velloo up/i);
  }, 60_000);

  test("the prompt init prints for a screen of the app opens with the setup", async () => {
    const app = await reactApp("next-app", {
      dependencies: { next: "15.0.0" },
      files: { "app/page.tsx": PAGE, "app/pricing/page.tsx": PAGE },
    });
    const stdout = await init(app, ["--start=redesign-screen"]);

    const prompt = stdout.slice(stdout.indexOf("Start your agent"), stdout.indexOf("How to use"));
    expect(prompt.split("\n").map((line) => line.trim())).toEqual(
      expect.arrayContaining([
        "Paste this to your AI agent:",
        "Use Velloo to redesign **Home**:",
        "1. Set Velloo up for my app (theme, fonts, components) before anything else.",
        "3. Explore a few different directions beside it on the same board.",
      ]),
    );
    expect(prompt).toContain("2. Recreate the whole real page on its scaffolded screen");
    // No library of its own, so none is promised: the design is on the primitives.
    expect(await library(app)).toBe("none");
    expect(stdout).not.toContain("shadcn");
  }, 30_000);

  test("an app nested below the directory init ran in is still the app to set up for", async () => {
    // `web/` beside a backend, in a repo with no package.json of its own.
    const repo = await reactApp("nested", {}, "web");
    const stdout = await init(repo, ["--start=blank"]);

    expect(await library(repo)).toBe("none");
    expect(stdout).toContain("the setup step finds the components your app has");
    expect(closingSteps(stdout)[2]).toStartWith("3. Ask your agent to set Velloo up for this app");
    expect(await readme(repo)).toContain("## First: set it up for your app");
  }, 30_000);

  test("the framework the app uses is adopted with its theme, and --library still outranks it", async () => {
    const files = {
      "src/theme.ts": `import { createTheme } from "@mui/material/styles";
        export default createTheme({ palette: { primary: { main: "#0b5fff" } }, shape: { borderRadius: 12 } });`,
    };
    const dependencies = { "@mui/material": "^6.0.0" };
    const adopted = await reactApp("mui-app", { dependencies, files });
    const pinned = await reactApp("mui-pinned", { dependencies, files });
    const plain = await reactApp("plain-pinned");
    const [adoptedOut, pinnedOut, plainOut] = await Promise.all([
      init(adopted, ["--start=blank"]),
      init(pinned, ["--start=blank", "--library=none"]),
      init(plain, ["--start=blank", "--library=shadcn-upstream"]),
    ]);

    expect(await library(adopted)).toBe("mui");
    expect(adoptedOut).toContain(`Imported your theme from ${join("src", "theme.ts")}.`);
    expect(adoptedOut).toMatch(/Theme\s+imported from /);
    const theme = await themeOf(adopted);
    expect(theme.colors.primary).toEqual({ DEFAULT: "#0b5fff", foreground: "#ffffff" });
    expect(theme.radius.md).toBe(12);

    // Asked for by name: the app is still read for its theme, not for its library.
    expect(await library(pinned)).toBe("none");
    expect(pinnedOut).not.toContain("Detected mui");
    expect(JSON.stringify((await themeOf(pinned)).colors.primary)).toContain("#0b5fff");

    expect(await library(plain)).toBe("shadcn-upstream");
    expect(plainOut).not.toContain("No UI library detected");
  }, 60_000);

  test("a Mantine theme kept apart from its provider is imported, and what it computes is left for setup", async () => {
    const app = await reactApp("mantine-app", {
      dependencies: { "@mantine/core": "^8.0.0" },
      files: {
        "src/main.jsx": `import { MantineProvider } from "@mantine/core";
          import { theme } from "./theme";
          root.render(<MantineProvider theme={theme}><App /></MantineProvider>);`,
        "src/theme.ts": `import { createTheme } from "@mantine/core";
          import { generateColors } from "@mantine/colors-generator";
          export const theme = createTheme({
            primaryColor: "brand",
            colors: { brand: generateColors("#375EAC") },
            fontFamily: "Inter, sans-serif",
            defaultRadius: "lg",
          });`,
      },
    });
    const stdout = await init(app, ["--start=blank"]);

    expect(await library(app)).toBe("none");
    expect(stdout).toContain(`Imported your theme from ${join("src", "theme.ts")}.`);
    expect(stdout).toContain("Fonts: Inter — from your Mantine theme.");
    // Said as a person reads it: the agent's backticks are gone.
    expect(stdout).toContain('Left for setup: the primary colour (generateColors("#375EAC")).');
    expect(stdout).not.toContain("Your app sets no Mantine theme");

    const theme = await themeOf(app);
    expect(theme.typography.fontFamily?.sans).toStartWith('"Inter", ');
    expect(theme.radius.md).toBe(16);
    expect(theme.colors.border).toBe("#dee2e6");
  }, 30_000);

  test("fonts traced to the app's font loader are named, and Tailwind settings with no token are counted for setup", async () => {
    const tailwindApp = (name: string, extend: string) =>
      reactApp(name, {
        dependencies: { next: "15.0.0" },
        devDependencies: { tailwindcss: "^3.4.0" },
        files: {
          "components.json": JSON.stringify({
            style: "new-york",
            tailwind: { css: "app/globals.css" },
          }),
          "app/globals.css":
            ":root { --background: 46 24% 92%; --primary: 64 92% 52%; --radius: 0rem; }\n",
          "app/page.tsx": PAGE,
          "app/layout.tsx": `import { Archivo_Black, Space_Grotesk } from "next/font/google";
            const display = Archivo_Black({ weight: "400", variable: "--font-display" });
            const sans = Space_Grotesk({ variable: "--font-sans" });`,
          "tailwind.config.ts": `export default { theme: { extend: {
            colors: { primary: { DEFAULT: "hsl(var(--primary))" } },
            fontFamily: { display: ["var(--font-display)", "Impact"], sans: ["var(--font-sans)", "sans-serif"] },
            ${extend}
          } } };`,
        },
      });
    const two = await tailwindApp(
      "tailwind-two",
      'letterSpacing: { machine: "0.22em" }, transitionTimingFunction: { snap: "cubic-bezier(0.2, 0, 0, 1)" },',
    );
    const one = await tailwindApp("tailwind-one", 'letterSpacing: { machine: "0.22em" },');
    const [twoOut, oneOut] = await Promise.all([
      init(two, ["--start=blank"]),
      init(one, ["--start=blank"]),
    ]);

    expect(twoOut).toContain(`Imported your theme from ${join("app", "globals.css")}.`);
    expect(twoOut).toContain("Fonts: Archivo Black, Space Grotesk — from your app's font loader.");
    const left = (stdout: string) =>
      stdout.split("\n").find((line) => line.includes("Left for setup:")) ?? "";
    expect(left(twoOut)).toContain(
      "2 Tailwind settings with no theme token (letterSpacing, transitionTimingFunction)",
    );
    expect(left(oneOut)).toContain("1 Tailwind setting with no theme token (letterSpacing)");
    // The gist, not the import's own names for things.
    for (const line of [left(twoOut), left(oneOut)]) {
      expect(line).not.toContain("tailwind.config theme.extend");
      expect(line).not.toContain("`");
      expect(line).toEndWith(".");
    }

    const theme = await themeOf(two);
    expect(theme.typography.fontFamily?.display).toStartWith('"Archivo Black", ');
    expect(await library(two)).toBe("shadcn-upstream");
  }, 60_000);
});
