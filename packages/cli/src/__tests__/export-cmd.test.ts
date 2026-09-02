import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `velloo export` e2e: the real command against a scaffolded
 * folder. HTML output only — browser-less, so it runs everywhere; the PNG/PDF
 * capture pipeline itself is covered by the server export-routes suite (and
 * chromium-gated there).
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-export-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const design = join(tmp, "velloo");
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(design, dir), { recursive: true });
  }
  await writeFile(
    join(design, ".design/config.json"),
    JSON.stringify({
      schemaVersion: 3,
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    }),
  );
  await writeFile(
    join(design, "theme/default.json"),
    JSON.stringify({
      name: "default",
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
      },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(design, "screens/home.json"),
    JSON.stringify({
      id: "home",
      name: "Home",
      tree: {
        $ref: "Box",
        children: [{ $ref: "Heading", props: { level: 1, children: "Export me" } }],
      },
    }),
  );
  await writeFile(
    join(design, "boards/main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      frames: [{ id: "f1", screen: "home", x: 0, y: 0, w: 400, h: 300, label: "Home frame" }],
      groups: [],
    }),
  );
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runExport(args: string[]) {
  const proc = Bun.spawn(["bun", cliPath, "export", ...args, "--folder", join(tmp, "velloo")], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, stderr, stdout };
}

test("screen → standalone .html picked by extension", async () => {
  const out = join(tmp, "home.html");
  const { exitCode, stderr } = await runExport(["home", "--to", out]);
  if (exitCode !== 0) throw new Error(`export failed: ${stderr}`);
  const html = await readFile(out, "utf8");
  expect(html).toContain("Export me");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<base");
});

test("board and frame targets export via the same command", async () => {
  const boardOut = join(tmp, "main.html");
  const board = await runExport(["main", "--to", boardOut, "--mode", "dark"]);
  if (board.exitCode !== 0) throw new Error(`board export failed: ${board.stderr}`);
  const boardHtml = await readFile(boardOut, "utf8");
  expect(boardHtml).toContain("<iframe");
  expect(boardHtml).toContain("Home frame");

  const frameOut = join(tmp, "frame.html");
  const frame = await runExport(["f1", "--to", frameOut]);
  if (frame.exitCode !== 0) throw new Error(`frame export failed: ${frame.stderr}`);
  expect(await readFile(frameOut, "utf8")).toContain("Export me");
});

test("unknown target and bad extension fail with actionable messages", async () => {
  const missing = await runExport(["nope", "--to", join(tmp, "x.html")]);
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain('no screen, frame, or board with id "nope"');
  expect(missing.stderr).toContain("main");

  const badExt = await runExport(["home", "--to", join(tmp, "x.txt")]);
  expect(badExt.exitCode).toBe(1);
  expect(badExt.stderr).toContain("unsupported output extension");

  const badCompare = await runExport(["main", "--to", join(tmp, "x.png"), "--mode", "compare"]);
  expect(badCompare.exitCode).toBe(1);
  expect(badCompare.stderr).toContain("compare");
});
