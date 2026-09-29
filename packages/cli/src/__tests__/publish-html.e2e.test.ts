import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromiumExecutable } from "@velloo/renderer";
import type { Server } from "bun";

setDefaultTimeout(60_000);

/**
 * Publishing an HTML/htmx design, end to end: the real command against a stub
 * cloud. The bundle carries the design's stored copies of the app's files,
 * every reference re-pointed at the shipped copy — and the running app is
 * never asked for anything.
 */

const hasChromium = (await chromiumExecutable()) !== null;
const cliPath = resolve(import.meta.dir, "../cli.ts");

// One pixel, so the image is a real PNG the cloud's type check accepts.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

let tmp: string;
let cloud: Server<undefined>;
let uploaded: Map<string, Uint8Array>;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-pub-html-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  uploaded = new Map();
  cloud = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "POST" && pathname === "/v1/links") {
        return Response.json(
          { slug: "test-slug", visibility: "public", passwordProtected: false },
          { status: 201 },
        );
      }
      if (req.method === "POST" && pathname.endsWith("/versions")) {
        const form = await req.formData();
        for (const value of form.getAll("file")) {
          if (value instanceof File) {
            uploaded.set(value.name, new Uint8Array(await value.arrayBuffer()));
          }
        }
        return Response.json(
          { files: uploaded.size, bytes: 1, url: "/s/test-slug/" },
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(async () => {
  cloud.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

async function scaffold(design: string): Promise<void> {
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(design, dir), { recursive: true });
  }
  await writeFile(
    join(design, ".design", "config.json"),
    JSON.stringify({
      schemaVersion: 4,
      name: "test",
      toolVersion: "0.0.1",
      libraries: {
        default: { id: "html", version: "1", source: "binary", componentsPath: "binary" },
      },
      defaultLibrary: "default",
      styling: { framework: "none" },
      hostApp: { root: "..", stylesheets: ["/static/css/app.css"] },
      viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    }),
  );
  await writeFile(
    join(design, "theme", "default.json"),
    JSON.stringify({
      name: "default",
      colors: {
        background: "#fff",
        foreground: "#111",
        primary: { DEFAULT: "#333", foreground: "#fff" },
      },
      typography: {},
      spacing: {},
      radius: {},
    }),
  );
  await writeFile(
    join(design, "screens", "contacts.json"),
    JSON.stringify({
      id: "contacts",
      name: "Contacts",
      library: "default",
      route: "/contacts",
      tree: {
        $ref: "Html",
        props: { as: "main" },
        children: [
          { $ref: "Html", props: { as: "img", src: "/static/logo.png", alt: "" } },
          {
            $ref: "Html",
            props: { as: "table", "hx-get": "/contacts/rows", "hx-trigger": "load" },
            children: [{ $ref: "Html", props: { as: "tr", children: "Tom & Jerry" } }],
          },
        ],
      },
    }),
  );
  // The copies store_host_files keeps: what the app served, as it served it.
  await mkdir(join(design, "assets/host/static/css"), { recursive: true });
  await mkdir(join(design, "assets/host/static/img"), { recursive: true });
  await writeFile(
    join(design, "assets/host/static/css/app.css"),
    ".row { background: url(../img/bg.png) } .x { background: url(data:,) }",
  );
  await writeFile(join(design, "assets/host/static/logo.png"), PNG);
  await writeFile(join(design, "assets/host/static/img/bg.png"), PNG);
  await writeFile(
    join(design, "boards", "main.json"),
    JSON.stringify({
      id: "main",
      name: "Main",
      frames: [{ id: "f1", screen: "contacts", x: 0, y: 0, w: 800, h: 600 }],
      groups: [],
    }),
  );
}

test.skipIf(!hasChromium)(
  "publishes the design's stored copies of the app's files, re-pointed at the shipped copies",
  async () => {
    const design = join(tmp, "velloo");
    await scaffold(design);
    const proc = Bun.spawn(
      [
        "bun",
        cliPath,
        "publish",
        design,
        "--url",
        `http://localhost:${cloud.port}`,
        "--token",
        "test-token",
        "--new",
        "--slug",
        "test-slug",
        "--public",
      ],
      { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    if (exitCode !== 0) throw new Error(`publish failed (${exitCode}): ${stderr}`);

    const text = (path: string) => new TextDecoder().decode(uploaded.get(path));
    const doc = JSON.parse(text("design.json")) as {
      screens: {
        tree: {
          children: { props: Record<string, unknown> }[];
        };
      }[];
      hostStylesheets?: string[];
    };
    const [img, table] = doc.screens[0]?.tree.children ?? [];
    const json = JSON.stringify(doc.screens);
    // The design's own nodes travel as written; its hx-* stay for the viewer to ignore.
    expect(table?.props["hx-get"]).toBe("/contacts/rows");
    expect(json).toContain("Tom & Jerry");

    // Host files travel, and every reference points at the shipped copy.
    expect(img?.props.src).toBe("/assets/host/static/logo.png");
    expect(json).not.toContain('"/static/logo.png"');
    expect(uploaded.get("assets/host/static/logo.png")).toEqual(PNG);
    expect(uploaded.get("assets/host/static/img/bg.png")).toEqual(PNG);
    expect(doc.hostStylesheets).toEqual(["assets/host/static/css/app.css"]);
    const css = text("assets/host/static/css/app.css");
    expect(css).toContain('url("/assets/host/static/img/bg.png")');
    expect(css).toContain("url(data:,)");
  },
  120_000,
);
