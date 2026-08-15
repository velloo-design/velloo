import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  ScreenSchema,
  SnippetSchema,
  ThemeSchema,
} from "@velloo/schema";

/**
 * End-to-end CLI smoke: run `velloo init` as a subprocess into a tmp
 * folder and confirm the scaffold matches every schema we ship. This
 * is the only test that exercises the full CLI surface; if it breaks,
 * onboarding is broken.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runInit(folder: string, extraArgs: string[] = []) {
  const proc = Bun.spawn(["bun", cliPath, "init", folder, ...extraArgs], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode, stdout, stderr };
}

describe("velloo init", () => {
  test("scaffolds a folder whose contents parse against every schema", async () => {
    const { exitCode, stdout, stderr } = await runInit(tmp);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("scaffolded");
    if (exitCode !== 0) {
      // Surface stderr so a CI failure is debuggable.
      throw new Error(`velloo init failed (${exitCode}): ${stderr}`);
    }

    // .design/config.json — init still writes the legacy single-library
    // shape today; the server's migrateConfig promotes it on load.
    const configRaw = await readFile(join(tmp, ".design/config.json"), "utf8");
    const config = ConfigSchema.parse(JSON.parse(configRaw));
    expect(config.library?.id).toBe("shadcn-react");
    // No `defaultBoard` is set so the canvas falls back to the
    // alphabetically-first board (the order the sidebar shows).
    expect(config.defaultBoard).toBeUndefined();
    expect(config.defaultScreen).toBeDefined();

    // theme/default.json
    const themeRaw = await readFile(join(tmp, "theme/default.json"), "utf8");
    const theme = ThemeSchema.parse(JSON.parse(themeRaw));
    expect(theme.name).toBeDefined();

    // screens/*.json — every file is a valid Screen
    const screenFiles = (await readdir(join(tmp, "screens"))).filter((f) => f.endsWith(".json"));
    expect(screenFiles.length).toBeGreaterThan(0);
    for (const f of screenFiles) {
      const raw = await readFile(join(tmp, "screens", f), "utf8");
      ScreenSchema.parse(JSON.parse(raw));
    }

    // boards/*.json
    const boardFiles = (await readdir(join(tmp, "boards"))).filter((f) => f.endsWith(".json"));
    expect(boardFiles.length).toBeGreaterThan(0);
    for (const f of boardFiles) {
      const raw = await readFile(join(tmp, "boards", f), "utf8");
      BoardSchema.parse(JSON.parse(raw));
    }

    // snippets/*.json
    const snippetFiles = (await readdir(join(tmp, "snippets"))).filter((f) => f.endsWith(".json"));
    expect(snippetFiles.length).toBeGreaterThan(0);
    for (const f of snippetFiles) {
      const raw = await readFile(join(tmp, "snippets", f), "utf8");
      SnippetSchema.parse(JSON.parse(raw));
    }
  }, 30_000);

  test("refuses to scaffold over a non-empty folder without --force", async () => {
    await Bun.write(join(tmp, "marker.txt"), "stay");
    const { exitCode, stderr } = await runInit(tmp);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("not empty");
  }, 30_000);

  test("writes a projectId, a README, and the new source vocabulary", async () => {
    const { exitCode } = await runInit(tmp);
    expect(exitCode).toBe(0);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")),
    );
    expect(config.library?.source).toBe("binary");
    expect(config.library?.componentsPath).toBe("binary");
    expect(typeof config.projectId).toBe("string");
    expect(config.projectId?.length ?? 0).toBeGreaterThan(0);

    const readme = await readFile(join(tmp, "README.md"), "utf8");
    expect(readme).toContain("Velloo design folder");
    expect(readme).toContain("shadcn");
  }, 30_000);

  test("blank initial content produces an empty board and zero screens", async () => {
    const { exitCode } = await runInit(tmp, ["--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")),
    );
    expect(config.defaultScreen).toBeUndefined();
    const screenFiles = (await readdir(join(tmp, "screens"))).filter((f) => f.endsWith(".json"));
    expect(screenFiles.length).toBe(0);
    const boardFiles = (await readdir(join(tmp, "boards"))).filter((f) => f.endsWith(".json"));
    expect(boardFiles.length).toBe(1);
  }, 30_000);

  test("--source=in-repo installs the snapshot to the app's components dir", async () => {
    const appPath = join(tmp, "host-app");
    await mkdir(appPath, { recursive: true });
    const designPath = join(tmp, "design");

    const { exitCode } = await runInit(designPath, [
      "--source=in-repo",
      `--app-path=${appPath}`,
      "--components-dir=src/components/ui",
      "--initial-content=blank",
    ]);
    expect(exitCode).toBe(0);

    const componentsDir = join(appPath, "src/components/ui");
    const providerJson = JSON.parse(await readFile(join(componentsDir, "provider.json"), "utf8"));
    expect(providerJson.providerId).toBe("shadcn-react");
    expect(typeof providerJson.version).toBe("string");

    // Tailwind entry CSS lands alongside the components so apps can
    // bootstrap their styling against the same baseline.
    expect(await Bun.file(join(componentsDir, "tailwind-entry.css")).exists()).toBe(true);

    // Iconic shadcn primitives made it across.
    expect(await Bun.file(join(componentsDir, "ui", "button.tsx")).exists()).toBe(true);
    expect(await Bun.file(join(componentsDir, "ui", "card.tsx")).exists()).toBe(true);

    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(designPath, ".design/config.json"), "utf8")),
    );
    expect(config.library?.source).toBe("in-repo");
    // componentsPath is design-folder-relative so the config travels well.
    expect(config.library?.componentsPath).toContain("src/components/ui");
  }, 30_000);

  test("--source=in-repo without --app-path fails fast with a clear message", async () => {
    const { exitCode, stderr } = await runInit(tmp, ["--source=in-repo"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--app-path");
  }, 30_000);

  test("--library=mui errors with the 'not yet vendored' message (Sprint X+2.1)", async () => {
    const { exitCode, stderr } = await runInit(tmp, ["--library=mui"]);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("mui");
    expect(stderr.toLowerCase()).toContain("vendored");
  }, 30_000);

  test("--library=none ships bare primitives with a two-screen sample", async () => {
    const { exitCode } = await runInit(tmp, ["--library=none"]);
    expect(exitCode).toBe(0);

    const config = ConfigSchema.parse(
      JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")),
    );
    expect(config.library?.id).toBe("none");
    expect(config.library?.source).toBe("binary");

    // Two welcome-style screens, one board.
    const screenFiles = (await readdir(join(tmp, "screens"))).filter((f) => f.endsWith(".json"));
    expect(screenFiles).toContain("welcome.json");
    expect(screenFiles).toContain("form.json");

    const boardFiles = (await readdir(join(tmp, "boards"))).filter((f) => f.endsWith(".json"));
    expect(boardFiles).toEqual(["main.json"]);

    // README mentions no-library specifics.
    const readme = await readFile(join(tmp, "README.md"), "utf8");
    expect(readme.toLowerCase()).toContain("no-library");
  }, 30_000);

  test("--library=none --initial-content=blank yields zero screens", async () => {
    const { exitCode } = await runInit(tmp, ["--library=none", "--initial-content=blank"]);
    expect(exitCode).toBe(0);
    const screenFiles = (await readdir(join(tmp, "screens"))).filter((f) => f.endsWith(".json"));
    expect(screenFiles.length).toBe(0);
  }, 30_000);

  test("--initial-content=scan generates one screen per Next.js app-router route", async () => {
    const appPath = join(tmp, "next-app");
    await mkdir(join(appPath, "app", "dashboard"), { recursive: true });
    await mkdir(join(appPath, "app", "settings", "account"), { recursive: true });
    await mkdir(join(appPath, "app", "blog", "[slug]"), { recursive: true });
    await writeFile(
      join(appPath, "package.json"),
      JSON.stringify({ dependencies: { next: "15.0.0", react: "19.2.6" } }),
    );
    await writeFile(join(appPath, "app", "page.tsx"), "export default function P(){return null}");
    await writeFile(
      join(appPath, "app", "dashboard", "page.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(appPath, "app", "settings", "account", "page.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(appPath, "app", "blog", "[slug]", "page.tsx"),
      "export default function P(){return null}",
    );

    const designPath = join(tmp, "design");
    const { exitCode, stderr } = await runInit(designPath, [
      "--initial-content=scan",
      `--app-path=${appPath}`,
    ]);
    expect(exitCode).toBe(0);
    if (exitCode !== 0) throw new Error(stderr);

    const screenFiles = (await readdir(join(designPath, "screens"))).filter((f) =>
      f.endsWith(".json"),
    );
    expect(screenFiles).toContain("index.json");
    expect(screenFiles).toContain("dashboard.json");
    expect(screenFiles).toContain("settings-account.json");
    expect(screenFiles).toContain("blog-slug.json");

    const boardFiles = (await readdir(join(designPath, "boards"))).filter((f) =>
      f.endsWith(".json"),
    );
    expect(boardFiles).toEqual(["app.json"]);

    const dashboard = JSON.parse(
      await readFile(join(designPath, "screens", "dashboard.json"), "utf8"),
    );
    expect(dashboard.name).toBe("Dashboard");
    const stringified = JSON.stringify(dashboard);
    expect(stringified).toContain("/dashboard");
  }, 30_000);

  test("--initial-content=scan picks up Vite-style src/routes/ files", async () => {
    const appPath = join(tmp, "vite-app");
    await mkdir(join(appPath, "src", "routes", "settings"), { recursive: true });
    await writeFile(
      join(appPath, "package.json"),
      JSON.stringify({ dependencies: { vite: "5.0.0", react: "19.2.6" } }),
    );
    await writeFile(
      join(appPath, "src", "routes", "index.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(appPath, "src", "routes", "about.tsx"),
      "export default function P(){return null}",
    );
    await writeFile(
      join(appPath, "src", "routes", "settings", "profile.tsx"),
      "export default function P(){return null}",
    );

    const designPath = join(tmp, "design");
    const { exitCode } = await runInit(designPath, [
      "--initial-content=scan",
      `--app-path=${appPath}`,
    ]);
    expect(exitCode).toBe(0);
    const screenFiles = (await readdir(join(designPath, "screens"))).filter((f) =>
      f.endsWith(".json"),
    );
    expect(screenFiles).toContain("index.json");
    expect(screenFiles).toContain("about.json");
    expect(screenFiles).toContain("settings-profile.json");
  }, 30_000);

  test("--initial-content=scan fails clearly when no routes are detectable", async () => {
    const appPath = join(tmp, "empty-app");
    await mkdir(appPath, { recursive: true });
    await writeFile(
      join(appPath, "package.json"),
      JSON.stringify({ dependencies: { react: "19.2.6" } }),
    );
    const designPath = join(tmp, "design");
    const { exitCode, stderr } = await runInit(designPath, [
      "--initial-content=scan",
      `--app-path=${appPath}`,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("no routes detected");
  }, 30_000);

  test("--initial-content=scan without --app-path fails fast", async () => {
    const { exitCode, stderr } = await runInit(tmp, ["--initial-content=scan"]);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("app-path");
  }, 30_000);
});
