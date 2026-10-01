import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Library } from "@velloo/schema";

/**
 * `velloo emit` e2e: the real command against a scaffolded folder, for each
 * library whose emit differs.
 *
 * The command resolves the screen's framework through the server's
 * `emitFrameworkContextFor`, the same resolver the MCP tool uses; a drift
 * between the two is invisible until a user runs the CLI.
 */

const cliPath = resolve(import.meta.dir, "../cli.ts");

let tmp: string;

async function scaffold(id: Library["id"], tree: unknown, framework?: "tailwind" | "none") {
  const design = join(tmp, "velloo");
  for (const dir of [".design", "theme", "screens"]) {
    await mkdir(join(design, dir), { recursive: true });
  }
  await writeFile(
    join(design, ".design/config.json"),
    JSON.stringify({
      schemaVersion: 4,
      name: "test",
      toolVersion: "0.0.1",
      libraries: { default: { id, version: "0.1.0", source: "binary", componentsPath: "binary" } },
      defaultLibrary: "default",
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
      ...(framework ? { styling: { framework } } : {}),
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
    JSON.stringify({ id: "home", name: "Home", tree }),
  );
  return design;
}

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-emit-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runEmit(design: string): Promise<Record<string, unknown>> {
  return runEmitArgs(["home", "--design", design]);
}

async function runEmitArgs(args: string[]): Promise<Record<string, unknown>> {
  const out = join(tmp, "ir.json");
  const proc = Bun.spawn(["bun", cliPath, "emit", ...args, "--to", out], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`emit failed: ${await new Response(proc.stderr).text()}`);
  }
  return JSON.parse(await readFile(out, "utf8"));
}

test("a shadcn screen emits library ids with their registry items to install", async () => {
  const design = await scaffold("shadcn-upstream", {
    $ref: "Card",
    children: [{ $ref: "Button", props: { children: "Go" } }],
  });
  const ir = await runEmit(design);
  expect(ir.jsx).toContain("<Card>");
  expect(ir.jsx).toContain("<Button>Go</Button>");
  expect(ir.componentsToInstall).toEqual(["button", "card"]);
  expect(ir.packagesToImport).toEqual([]);
});

test("a screen outside any design folder emits against the default framework", async () => {
  await mkdir(tmp, { recursive: true });
  const screenPath = join(tmp, "loose.json");
  await writeFile(
    screenPath,
    JSON.stringify({
      id: "loose",
      name: "Loose",
      tree: { $ref: "Card", children: [{ $ref: "Button", props: { children: "Go" } }] },
    }),
  );
  const ir = await runEmitArgs([screenPath]);
  expect(ir.jsx).toContain("<Card>");
  expect(ir.jsx).toContain("<Button>Go</Button>");
  expect(ir.componentsToInstall).toEqual(["button", "card"]);
});

test("an antd screen emits antd components and its dotted exports", async () => {
  const design = await scaffold("antd", {
    $ref: "Card",
    children: [{ $ref: "TypographyTitle", props: { level: 2, children: "Hi" } }],
  });
  const ir = await runEmit(design);
  expect(ir.jsx).toContain("<Card>");
  expect(ir.jsx).toContain("<Typography.Title level={2}>Hi</Typography.Title>");
  expect(ir.packagesToImport).toEqual(["antd"]);
});

test("a none/none screen emits inline-styled plain HTML", async () => {
  const design = await scaffold(
    "none",
    { $ref: "Card", children: [{ $ref: "Button", props: { children: "Go" } }] },
    "none",
  );
  const ir = await runEmit(design);
  expect(ir.jsx).toContain("<div style={{");
  expect(ir.jsx).toContain("<button style={{");
  expect(ir.jsx).not.toContain("className");
  expect(ir.componentsToInstall).toEqual([]);
});

test("an HTML folder emits native markup, not JSX", async () => {
  const design = await scaffold("html", {
    $ref: "Html",
    props: { as: "section" },
    children: [{ $ref: "Html", props: { as: "p", children: "Hello" } }],
  });
  const out = join(tmp, "home.html");
  const proc = Bun.spawn(["bun", cliPath, "emit", "home", "--design", design, "--to", out], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`emit failed: ${await new Response(proc.stderr).text()}`);
  }
  const html = await readFile(out, "utf8");
  expect(html).toContain("<section");
  expect(html).toContain("Hello");
});

test("a screen file inside a none/none folder emits on the folder's channel", async () => {
  const tree = { $ref: "Stack", children: [{ $ref: "Text", props: { children: "Hi" } }] };
  const design = await scaffold("none", tree, "none");
  // Not one of the folder's screens — a copy beside them still belongs to it.
  const inside = join(design, "copy.json");
  await writeFile(inside, JSON.stringify({ id: "copy", name: "Copy", tree }));
  const ir = await runEmitArgs([inside]);
  expect(ir.jsx).toContain("<div style={{");
  expect(ir.jsx).not.toContain("className");

  // The same file outside any folder has no config to read, so it emits
  // against the default framework's Tailwind channel.
  const outside = join(tmp, "loose.json");
  await writeFile(outside, JSON.stringify({ id: "loose", name: "Loose", tree }));
  expect((await runEmitArgs([outside])).jsx).toContain('<div className="flex flex-col');
});

test("the printed header names components the way the code spells them", async () => {
  const design = await scaffold("antd", {
    $ref: "Card",
    children: [{ $ref: "TypographyText", props: { children: "Hi" } }],
  });
  const proc = Bun.spawn(["bun", cliPath, "emit", "home", "--design", design], {
    cwd: resolve(import.meta.dir, "../../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`emit failed: ${await new Response(proc.stderr).text()}`);
  }
  const out = await new Response(proc.stdout).text();
  expect(out).toContain("// components: Card, Typography.Text\n");
  expect(out).toContain("<Typography.Text>Hi</Typography.Text>");
});
